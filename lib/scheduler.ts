import {
  AccountStatus,
  ActivityLevel,
  AttemptStatus,
  Prisma,
  ScheduleStatus
} from "@prisma/client";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { isTooSimilar } from "@/lib/risk";
import {
  type AccountProxyConfig,
  publishPostToX,
  refreshAccessTokenOnX
} from "@/lib/x-api";

const RETRY_MINUTES = [2, 10, 30];

type DueSchedule = Prisma.ScheduleGetPayload<{
  include: {
    account: true;
    content: true;
    variant: true;
  };
}>;

export type PublisherSummary = {
  scanned: number;
  attempted: number;
  posted: number;
  failed: number;
  blocked: number;
  rescheduled: number;
};

function startOfDay(date: Date): Date {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function computeRetryAt(now: Date, attemptCount: number, resetAt?: Date | null): Date {
  const idx = Math.max(0, Math.min(RETRY_MINUTES.length - 1, attemptCount - 1));
  const retryByBackoff = addMinutes(now, RETRY_MINUTES[idx]);
  if (resetAt && resetAt.getTime() > retryByBackoff.getTime()) {
    return resetAt;
  }
  return retryByBackoff;
}

function mapProxyProtocol(value: DueSchedule["account"]["proxyProtocol"]): AccountProxyConfig["protocol"] | null {
  if (!value) {
    return null;
  }
  if (value === "HTTP") {
    return "http";
  }
  if (value === "HTTPS") {
    return "https";
  }
  return null;
}

function resolveProxyConfig(schedule: DueSchedule): {
  proxy?: AccountProxyConfig;
  error?: string;
} {
  if (!schedule.account.proxyEnabled) {
    return {};
  }
  const protocol = mapProxyProtocol(schedule.account.proxyProtocol);
  if (!protocol || !schedule.account.proxyHost || !schedule.account.proxyPort) {
    return {
      error: "Proxy is enabled but proxy settings are incomplete."
    };
  }

  let password: string | undefined;
  if (schedule.account.proxyPasswordEncrypted) {
    try {
      password = decryptSecret(schedule.account.proxyPasswordEncrypted);
    } catch {
      return {
        error: "Cannot decrypt proxy password. Check TOKEN_ENCRYPTION_KEY."
      };
    }
  }

  return {
    proxy: {
      protocol,
      host: schedule.account.proxyHost,
      port: schedule.account.proxyPort,
      username: schedule.account.proxyUsername ?? undefined,
      password
    }
  };
}

async function logActivity(input: {
  level: ActivityLevel;
  event: string;
  message: string;
  accountId?: string;
  scheduleId?: string;
  meta?: Prisma.InputJsonValue;
}) {
  await db.activityLog.create({
    data: {
      level: input.level,
      event: input.event,
      message: input.message,
      accountId: input.accountId,
      scheduleId: input.scheduleId,
      meta: input.meta
    }
  });
}

async function blockSchedule(schedule: DueSchedule, reason: string, accountStatus?: AccountStatus) {
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.schedule.update({
      where: {
        id: schedule.id
      },
      data: {
        status: ScheduleStatus.BLOCKED,
        lastError: reason,
        nextAttemptAt: null,
        updatedAt: now
      }
    });

    if (accountStatus) {
      await tx.account.update({
        where: {
          id: schedule.accountId
        },
        data: {
          status: accountStatus,
          healthMessage: reason
        }
      });
    }

    await tx.publishAttempt.create({
      data: {
        accountId: schedule.accountId,
        scheduleId: schedule.id,
        attemptNo: schedule.attemptCount + 1,
        status: AttemptStatus.BLOCKED,
        requestedAt: now,
        finishedAt: now,
        errorMessage: reason
      }
    });
  });

  await logActivity({
    level: ActivityLevel.ERROR,
    event: "schedule_blocked",
    message: reason,
    accountId: schedule.accountId,
    scheduleId: schedule.id
  });
}

async function applyRiskGuards(schedule: DueSchedule, recentBodies: string[]): Promise<{
  blockedReason?: string;
  rescheduledAt?: Date;
}> {
  const now = new Date();

  if (schedule.account.lastPostedAt) {
    const minNext = addMinutes(schedule.account.lastPostedAt, schedule.account.minIntervalMinutes);
    if (minNext.getTime() > now.getTime()) {
      return {
        rescheduledAt: minNext
      };
    }
  }

  const [dayPosts, monthPosts] = await Promise.all([
    db.schedule.count({
      where: {
        accountId: schedule.accountId,
        status: ScheduleStatus.POSTED,
        postedAt: {
          gte: startOfDay(now)
        }
      }
    }),
    db.schedule.count({
      where: {
        accountId: schedule.accountId,
        status: ScheduleStatus.POSTED,
        postedAt: {
          gte: startOfMonth(now)
        }
      }
    })
  ]);

  if (dayPosts >= schedule.account.dailyPostLimit) {
    return {
      blockedReason: `Daily quota reached (${schedule.account.dailyPostLimit}).`
    };
  }

  if (monthPosts >= schedule.account.monthlyPostLimit) {
    return {
      blockedReason: `Monthly quota reached (${schedule.account.monthlyPostLimit}).`
    };
  }

  if (isTooSimilar(schedule.variant.body, recentBodies)) {
    return {
      blockedReason: "Content too similar to recent published posts."
    };
  }

  return {};
}

async function processSchedule(schedule: DueSchedule, recentBodies: string[]): Promise<"posted" | "failed" | "blocked" | "rescheduled"> {
  const proxyResolution = resolveProxyConfig(schedule);
  if (proxyResolution.error) {
    await blockSchedule(schedule, proxyResolution.error);
    return "blocked";
  }
  const proxy = proxyResolution.proxy;

  let accessToken = "";
  if (
    schedule.account.tokenExpiresAt &&
    schedule.account.tokenExpiresAt.getTime() <= Date.now()
  ) {
    if (!schedule.account.refreshTokenEncrypted) {
      await blockSchedule(
        schedule,
        "Token expired and refresh token is missing.",
        AccountStatus.TOKEN_EXPIRED
      );
      return "blocked";
    }

    try {
      const refreshToken = decryptSecret(schedule.account.refreshTokenEncrypted);
      const refreshed = await refreshAccessTokenOnX(refreshToken, proxy);
      if (!refreshed.ok) {
        await blockSchedule(
          schedule,
          `Token refresh failed: ${refreshed.errorMessage}`,
          AccountStatus.TOKEN_EXPIRED
        );
        return "blocked";
      }

      await db.account.update({
        where: {
          id: schedule.accountId
        },
        data: {
          accessTokenEncrypted: encryptSecret(refreshed.accessToken),
          refreshTokenEncrypted: refreshed.refreshToken
            ? encryptSecret(refreshed.refreshToken)
            : schedule.account.refreshTokenEncrypted,
          tokenExpiresAt: refreshed.expiresAt,
          status: AccountStatus.ACTIVE,
          healthMessage: null
        }
      });
      accessToken = refreshed.accessToken;
    } catch {
      await blockSchedule(
        schedule,
        "Token expired and refresh flow failed unexpectedly.",
        AccountStatus.TOKEN_EXPIRED
      );
      return "blocked";
    }
  } else {
    try {
      accessToken = decryptSecret(schedule.account.accessTokenEncrypted);
    } catch {
      await blockSchedule(schedule, "Cannot decrypt access token. Fix TOKEN_ENCRYPTION_KEY.");
      return "blocked";
    }
  }

  const guard = await applyRiskGuards(schedule, recentBodies);
  if (guard.blockedReason) {
    const status =
      guard.blockedReason.includes("Token expired") ? AccountStatus.TOKEN_EXPIRED : undefined;
    await blockSchedule(schedule, guard.blockedReason, status);
    return "blocked";
  }

  if (guard.rescheduledAt) {
    await db.schedule.update({
      where: {
        id: schedule.id
      },
      data: {
        status: ScheduleStatus.PENDING,
        plannedAt: guard.rescheduledAt,
        nextAttemptAt: null,
        lastError: `Rescheduled to respect min interval (${schedule.account.minIntervalMinutes}m).`
      }
    });
    await logActivity({
      level: ActivityLevel.WARN,
      event: "schedule_rescheduled",
      message: "Rescheduled because minimal publish interval was not reached.",
      accountId: schedule.accountId,
      scheduleId: schedule.id,
      meta: {
        plannedAt: guard.rescheduledAt.toISOString()
      }
    });
    return "rescheduled";
  }

  const now = new Date();
  const attemptNo = schedule.attemptCount + 1;
  const publishResult = await publishPostToX({
    accessToken,
    text: schedule.variant.body,
    proxy
  });

  if (publishResult.ok) {
    await db.$transaction(async (tx) => {
      await tx.schedule.update({
        where: {
          id: schedule.id
        },
        data: {
          status: ScheduleStatus.POSTED,
          postedAt: now,
          externalPostId: publishResult.postId ?? null,
          attemptCount: attemptNo,
          lastError: null,
          nextAttemptAt: null
        }
      });

      await tx.account.update({
        where: {
          id: schedule.accountId
        },
        data: {
          status: AccountStatus.ACTIVE,
          healthMessage: null,
          lastPostedAt: now
        }
      });

      await tx.publishAttempt.create({
        data: {
          accountId: schedule.accountId,
          scheduleId: schedule.id,
          attemptNo,
          status: AttemptStatus.SUCCESS,
          requestedAt: now,
          finishedAt: now,
          httpStatus: publishResult.status,
          rateLimitLimit: publishResult.rateLimit.limit,
          rateLimitRemaining: publishResult.rateLimit.remaining,
          rateLimitResetAt: publishResult.rateLimit.resetAt
        }
      });

      await tx.rateLimitSnapshot.create({
        data: {
          accountId: schedule.accountId,
          endpoint: "POST /2/tweets",
          limit: publishResult.rateLimit.limit,
          remaining: publishResult.rateLimit.remaining,
          resetAt: publishResult.rateLimit.resetAt
        }
      });

      await tx.postMetric.create({
        data: {
          accountId: schedule.accountId,
          scheduleId: schedule.id
        }
      });
    });

    await logActivity({
      level: ActivityLevel.INFO,
      event: "schedule_posted",
      message: "Scheduled post was published successfully.",
      accountId: schedule.accountId,
      scheduleId: schedule.id
    });
    recentBodies.unshift(schedule.variant.body);
    if (recentBodies.length > 250) {
      recentBodies.pop();
    }
    return "posted";
  }

  const shouldForceBlock = publishResult.status === 401 || publishResult.status === 403;
  const canRetry = !shouldForceBlock && attemptNo < schedule.maxAttempts;
  const nextAttemptAt = canRetry
    ? computeRetryAt(now, attemptNo, publishResult.rateLimit.resetAt)
    : null;
  const nextStatus = canRetry ? ScheduleStatus.FAILED : ScheduleStatus.BLOCKED;
  const accountStatus =
    publishResult.status === 429
      ? AccountStatus.RATE_LIMITED
      : publishResult.status === 401
        ? AccountStatus.TOKEN_EXPIRED
        : publishResult.status === 403
          ? AccountStatus.SUSPENDED
          : schedule.account.status;

  await db.$transaction(async (tx) => {
    await tx.schedule.update({
      where: {
        id: schedule.id
      },
      data: {
        status: nextStatus,
        attemptCount: attemptNo,
        nextAttemptAt,
        lastError: publishResult.errorMessage ?? `HTTP ${publishResult.status}`
      }
    });

    await tx.account.update({
      where: {
        id: schedule.accountId
      },
      data: {
        status: accountStatus,
        healthMessage: publishResult.errorMessage ?? `HTTP ${publishResult.status}`
      }
    });

    await tx.publishAttempt.create({
      data: {
        accountId: schedule.accountId,
        scheduleId: schedule.id,
        attemptNo,
        status: AttemptStatus.FAIL,
        requestedAt: now,
        finishedAt: now,
        httpStatus: publishResult.status,
        errorCode: publishResult.errorCode,
        errorMessage: publishResult.errorMessage,
        rateLimitLimit: publishResult.rateLimit.limit,
        rateLimitRemaining: publishResult.rateLimit.remaining,
        rateLimitResetAt: publishResult.rateLimit.resetAt
      }
    });

    await tx.rateLimitSnapshot.create({
      data: {
        accountId: schedule.accountId,
        endpoint: "POST /2/tweets",
        limit: publishResult.rateLimit.limit,
        remaining: publishResult.rateLimit.remaining,
        resetAt: publishResult.rateLimit.resetAt
      }
    });
  });

  await logActivity({
    level: canRetry ? ActivityLevel.WARN : ActivityLevel.ERROR,
    event: canRetry ? "schedule_retry_scheduled" : "schedule_publish_failed",
    message: canRetry
      ? `Publish failed, retry at ${nextAttemptAt?.toISOString()}.`
      : `Publish failed and was blocked. ${publishResult.errorMessage ?? ""}`.trim(),
    accountId: schedule.accountId,
    scheduleId: schedule.id,
    meta: {
      httpStatus: publishResult.status,
      nextAttemptAt: nextAttemptAt?.toISOString() ?? null
    }
  });

  return canRetry ? "failed" : "blocked";
}

export async function runPublisherCycle(limit = 30): Promise<PublisherSummary> {
  const now = new Date();
  const dueSchedules = await db.schedule.findMany({
    where: {
      OR: [
        {
          status: ScheduleStatus.PENDING,
          plannedAt: {
            lte: now
          }
        },
        {
          status: ScheduleStatus.FAILED,
          nextAttemptAt: {
            lte: now
          }
        }
      ]
    },
    orderBy: [
      {
        priority: "asc"
      },
      {
        plannedAt: "asc"
      }
    ],
    include: {
      account: true,
      content: true,
      variant: true
    },
    take: limit
  });

  const recentWindow = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const recentPosts = await db.schedule.findMany({
    where: {
      status: ScheduleStatus.POSTED,
      postedAt: {
        gte: recentWindow
      }
    },
    include: {
      variant: true
    },
    orderBy: {
      postedAt: "desc"
    },
    take: 250
  });
  const recentBodies = recentPosts.map((item) => item.variant.body);
  const accountSeen = new Set<string>();

  const summary: PublisherSummary = {
    scanned: dueSchedules.length,
    attempted: 0,
    posted: 0,
    failed: 0,
    blocked: 0,
    rescheduled: 0
  };

  for (const schedule of dueSchedules) {
    if (accountSeen.has(schedule.accountId)) {
      continue;
    }
    accountSeen.add(schedule.accountId);
    summary.attempted += 1;

    const outcome = await processSchedule(schedule, recentBodies);
    if (outcome === "posted") {
      summary.posted += 1;
    } else if (outcome === "failed") {
      summary.failed += 1;
    } else if (outcome === "blocked") {
      summary.blocked += 1;
    } else if (outcome === "rescheduled") {
      summary.rescheduled += 1;
    }
  }

  return summary;
}
