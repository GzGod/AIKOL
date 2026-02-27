import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serverError } from "@/lib/http";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const account = await db.account.findUnique({
      where: {
        id
      }
    });
    if (!account) {
      return NextResponse.json(
        {
          error: "not_found",
          message: "账号不存在。"
        },
        {
          status: 404
        }
      );
    }

    const [attempts, latestRateLimit] = await Promise.all([
      db.publishAttempt.findMany({
        where: {
          accountId: id
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 50
      }),
      db.rateLimitSnapshot.findFirst({
        where: {
          accountId: id
        },
        orderBy: {
          observedAt: "desc"
        }
      })
    ]);

    const recent = attempts.slice(0, 20);
    const failureCount = recent.filter((item) => item.status !== "SUCCESS").length;
    const failureRate = recent.length > 0 ? Number((failureCount / recent.length).toFixed(2)) : 0;
    const tokenHealthy =
      !account.tokenExpiresAt || account.tokenExpiresAt.getTime() > Date.now();

    return NextResponse.json({
      data: {
        id: account.id,
        username: account.username,
        status: account.status,
        proxy: {
          enabled: account.proxyEnabled,
          protocol: account.proxyProtocol?.toLowerCase() ?? null,
          host: account.proxyHost,
          port: account.proxyPort
        },
        tokenHealthy,
        tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
        failureRate,
        attemptsInWindow: recent.length,
        latestRateLimit: latestRateLimit
          ? {
              endpoint: latestRateLimit.endpoint,
              limit: latestRateLimit.limit,
              remaining: latestRateLimit.remaining,
              resetAt: latestRateLimit.resetAt?.toISOString() ?? null,
              observedAt: latestRateLimit.observedAt.toISOString()
            }
          : null
      }
    });
  } catch (error) {
    return serverError(error);
  }
}
