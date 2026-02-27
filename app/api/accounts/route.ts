import { AccountStatus, Prisma, ProxyProtocol } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { encryptSecret } from "@/lib/crypto";
import { db } from "@/lib/db";
import { badRequest, serverError } from "@/lib/http";

type AccountPayload = {
  xUserId?: string;
  username?: string;
  displayName?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  language?: string;
  purpose?: string;
  tagNames?: string[];
  groupNames?: string[];
  minIntervalMinutes?: number;
  dailyPostLimit?: number;
  monthlyPostLimit?: number;
  proxyEnabled?: boolean;
  proxyProtocol?: string;
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
};

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((item) => String(item).trim())
        .filter((item) => item.length > 0)
    )
  ).slice(0, 30);
}

function normalizeProxyProtocol(value: string | undefined): ProxyProtocol | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "http") {
    return ProxyProtocol.HTTP;
  }
  if (normalized === "https") {
    return ProxyProtocol.HTTPS;
  }
  return null;
}

function proxyProtocolToString(value: ProxyProtocol | null): string | null {
  if (!value) {
    return null;
  }
  if (value === ProxyProtocol.HTTP) {
    return "http";
  }
  if (value === ProxyProtocol.HTTPS) {
    return "https";
  }
  return null;
}

export async function GET() {
  try {
    const rows = await db.account.findMany({
      include: {
        tagLinks: {
          include: {
            tag: true
          }
        },
        groupMemberships: {
          include: {
            group: true
          }
        },
        _count: {
          select: {
            schedules: true
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    const now = Date.now();
    const data = rows.map((item) => {
      const expired =
        item.tokenExpiresAt && item.tokenExpiresAt.getTime() <= now;
      return {
        id: item.id,
        xUserId: item.xUserId,
        username: item.username,
        displayName: item.displayName,
        language: item.language,
        purpose: item.purpose,
        status: expired ? AccountStatus.TOKEN_EXPIRED : item.status,
        healthMessage: item.healthMessage,
        tokenExpiresAt: item.tokenExpiresAt?.toISOString() ?? null,
        minIntervalMinutes: item.minIntervalMinutes,
        dailyPostLimit: item.dailyPostLimit,
        monthlyPostLimit: item.monthlyPostLimit,
        proxy: {
          enabled: item.proxyEnabled,
          protocol: proxyProtocolToString(item.proxyProtocol),
          host: item.proxyHost,
          port: item.proxyPort,
          username: item.proxyUsername,
          hasPassword: Boolean(item.proxyPasswordEncrypted)
        },
        lastPostedAt: item.lastPostedAt?.toISOString() ?? null,
        tags: item.tagLinks.map((link) => link.tag.name),
        groups: item.groupMemberships.map((link) => link.group.name),
        scheduleCount: item._count.schedules,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString()
      };
    });

    return NextResponse.json({ data });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as AccountPayload;
    const xUserId = payload.xUserId?.trim();
    const username = payload.username?.trim().replace(/^@+/, "");
    const displayName = payload.displayName?.trim();
    const accessToken = payload.accessToken?.trim();

    if (!xUserId || !username || !displayName || !accessToken) {
      return badRequest("xUserId、username、displayName、accessToken 均为必填项。");
    }

    const tokenExpiresAt =
      payload.tokenExpiresAt && payload.tokenExpiresAt.trim()
        ? new Date(payload.tokenExpiresAt)
        : null;
    if (tokenExpiresAt && Number.isNaN(tokenExpiresAt.getTime())) {
      return badRequest("tokenExpiresAt 必须是合法的日期时间字符串。");
    }

    const now = Date.now();
    const resolvedStatus =
      tokenExpiresAt && tokenExpiresAt.getTime() <= now
        ? AccountStatus.TOKEN_EXPIRED
        : AccountStatus.ACTIVE;
    const tagNames = normalizeList(payload.tagNames);
    const groupNames = normalizeList(payload.groupNames);
    const safeMinInterval = Math.max(
      5,
      Math.min(240, Math.floor(payload.minIntervalMinutes ?? 20))
    );
    const safeDailyLimit = Math.max(
      1,
      Math.min(5000, Math.floor(payload.dailyPostLimit ?? 50))
    );
    const safeMonthlyLimit = Math.max(
      safeDailyLimit,
      Math.min(200000, Math.floor(payload.monthlyPostLimit ?? 1000))
    );
    const proxyEnabled = Boolean(payload.proxyEnabled);
    const proxyProtocol = normalizeProxyProtocol(payload.proxyProtocol);
    const proxyHost = payload.proxyHost?.trim() || null;
    const proxyPort = Number(payload.proxyPort);
    const proxyUsername = payload.proxyUsername?.trim() || null;
    const proxyPassword = payload.proxyPassword?.trim() || "";

    if (proxyEnabled) {
      if (!proxyProtocol) {
        return badRequest("启用代理时，proxyProtocol 必须为 http 或 https。");
      }
      if (!proxyHost) {
        return badRequest("启用代理时，proxyHost 为必填项。");
      }
      if (!Number.isFinite(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
        return badRequest("启用代理时，proxyPort 必须在 1-65535 之间。");
      }
    }

    const result = await db.$transaction(async (tx) => {
      const existingAccount = await tx.account.findUnique({
        where: {
          xUserId
        },
        select: {
          proxyPasswordEncrypted: true
        }
      });
      const encryptedAccessToken = encryptSecret(accessToken);
      const encryptedRefreshToken =
        payload.refreshToken && payload.refreshToken.trim()
          ? encryptSecret(payload.refreshToken.trim())
          : null;
      const encryptedProxyPassword = proxyPassword ? encryptSecret(proxyPassword) : null;

      const accountUpdateData: Prisma.AccountUpdateInput = {
        username,
        displayName,
        language: payload.language?.trim() || null,
        purpose: payload.purpose?.trim() || null,
        accessTokenEncrypted: encryptedAccessToken,
        tokenExpiresAt,
        status: resolvedStatus,
        minIntervalMinutes: safeMinInterval,
        dailyPostLimit: safeDailyLimit,
        monthlyPostLimit: safeMonthlyLimit,
        proxyEnabled,
        proxyProtocol: proxyEnabled ? proxyProtocol : null,
        proxyHost: proxyEnabled ? proxyHost : null,
        proxyPort: proxyEnabled ? Math.floor(proxyPort) : null,
        proxyUsername: proxyEnabled ? proxyUsername : null
      };
      if (encryptedRefreshToken) {
        accountUpdateData.refreshTokenEncrypted = encryptedRefreshToken;
      }
      if (proxyEnabled) {
        if (encryptedProxyPassword) {
          accountUpdateData.proxyPasswordEncrypted = encryptedProxyPassword;
        }
      } else {
        accountUpdateData.proxyPasswordEncrypted = null;
      }

      const account = await tx.account.upsert({
        where: {
          xUserId
        },
        update: accountUpdateData,
        create: {
          xUserId,
          username,
          displayName,
          language: payload.language?.trim() || null,
          purpose: payload.purpose?.trim() || null,
          accessTokenEncrypted: encryptedAccessToken,
          refreshTokenEncrypted: encryptedRefreshToken,
          tokenExpiresAt,
          status: resolvedStatus,
          minIntervalMinutes: safeMinInterval,
          dailyPostLimit: safeDailyLimit,
          monthlyPostLimit: safeMonthlyLimit,
          proxyEnabled,
          proxyProtocol: proxyEnabled ? proxyProtocol : null,
          proxyHost: proxyEnabled ? proxyHost : null,
          proxyPort: proxyEnabled ? Math.floor(proxyPort) : null,
          proxyUsername: proxyEnabled ? proxyUsername : null,
          proxyPasswordEncrypted: proxyEnabled
            ? encryptedProxyPassword ?? existingAccount?.proxyPasswordEncrypted ?? null
            : null
        }
      });

      const tags = [];
      for (const name of tagNames) {
        const tag = await tx.tag.upsert({
          where: {
            name
          },
          update: {},
          create: {
            name
          }
        });
        tags.push(tag);
      }
      await tx.accountTag.deleteMany({
        where: {
          accountId: account.id
        }
      });
      if (tags.length > 0) {
        await tx.accountTag.createMany({
          data: tags.map((tag) => ({
            accountId: account.id,
            tagId: tag.id
          }))
        });
      }

      const groups = [];
      for (const name of groupNames) {
        const group = await tx.accountGroup.upsert({
          where: {
            name
          },
          update: {},
          create: {
            name
          }
        });
        groups.push(group);
      }
      await tx.accountGroupMember.deleteMany({
        where: {
          accountId: account.id
        }
      });
      if (groups.length > 0) {
        await tx.accountGroupMember.createMany({
          data: groups.map((group) => ({
            accountId: account.id,
            groupId: group.id
          }))
        });
      }

      await tx.activityLog.create({
        data: {
          level: "INFO",
          event: "account_upserted",
          message: `账号 @${username} 已新增或更新。`,
          accountId: account.id,
          meta: {
            tags: tagNames,
            groups: groupNames
          }
        }
      });

      return account;
    });

    return NextResponse.json({
      data: {
        id: result.id,
        username: result.username
      }
    });
  } catch (error) {
    return serverError(error);
  }
}
