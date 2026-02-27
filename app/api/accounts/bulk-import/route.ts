import { NextRequest, NextResponse } from "next/server";
import { ProxyProtocol } from "@prisma/client";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { badRequest, serverError } from "@/lib/http";

type BulkAccountInput = {
  xUserId?: string;
  username?: string;
  displayName?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  language?: string;
  purpose?: string;
  tags?: string[];
  groups?: string[];
  proxyEnabled?: boolean;
  proxyProtocol?: string;
  proxyHost?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
};

function normalize(list: unknown): string[] {
  if (!Array.isArray(list)) {
    return [];
  }
  return Array.from(new Set(list.map((item) => String(item).trim()).filter(Boolean)));
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

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      accounts?: BulkAccountInput[];
    };
    const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
    if (accounts.length === 0) {
      return badRequest("accounts must be a non-empty array.");
    }
    if (accounts.length > 200) {
      return badRequest("At most 200 accounts per request.");
    }

    const report = [];
    for (const item of accounts) {
      const xUserId = item.xUserId?.trim();
      const username = item.username?.trim().replace(/^@+/, "");
      const displayName = item.displayName?.trim() || username;
      const accessToken = item.accessToken?.trim();
      if (!xUserId || !username || !accessToken) {
        report.push({
          xUserId: xUserId ?? null,
          username: username ?? null,
          status: "skipped",
          reason: "missing required fields"
        });
        continue;
      }

      const expiresAt =
        item.tokenExpiresAt && item.tokenExpiresAt.trim()
          ? new Date(item.tokenExpiresAt)
          : null;
      const proxyEnabled = Boolean(item.proxyEnabled);
      const proxyProtocol = normalizeProxyProtocol(item.proxyProtocol);
      const proxyHost = item.proxyHost?.trim() || null;
      const proxyPort = Number(item.proxyPort);
      const proxyUsername = item.proxyUsername?.trim() || null;
      const proxyPassword = item.proxyPassword?.trim() || "";

      if (proxyEnabled) {
        if (!proxyProtocol || !proxyHost || !Number.isFinite(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
          report.push({
            xUserId,
            username,
            status: "skipped",
            reason: "invalid proxy config"
          });
          continue;
        }
      }

      const account = await db.$transaction(async (tx) => {
        const existing = await tx.account.findUnique({
          where: {
            xUserId
          },
          select: {
            proxyPasswordEncrypted: true
          }
        });
        const upserted = await tx.account.upsert({
          where: {
            xUserId
          },
          update: {
            username,
            displayName: displayName ?? username,
            language: item.language?.trim() || null,
            purpose: item.purpose?.trim() || null,
            accessTokenEncrypted: encryptSecret(accessToken),
            refreshTokenEncrypted: item.refreshToken?.trim()
              ? encryptSecret(item.refreshToken.trim())
              : undefined,
            tokenExpiresAt: expiresAt,
            proxyEnabled,
            proxyProtocol: proxyEnabled ? proxyProtocol : null,
            proxyHost: proxyEnabled ? proxyHost : null,
            proxyPort: proxyEnabled ? Math.floor(proxyPort) : null,
            proxyUsername: proxyEnabled ? proxyUsername : null,
            proxyPasswordEncrypted: proxyEnabled
              ? proxyPassword
                ? encryptSecret(proxyPassword)
                : undefined
              : null
          },
          create: {
            xUserId,
            username,
            displayName: displayName ?? username,
            language: item.language?.trim() || null,
            purpose: item.purpose?.trim() || null,
            accessTokenEncrypted: encryptSecret(accessToken),
            refreshTokenEncrypted: item.refreshToken?.trim()
              ? encryptSecret(item.refreshToken.trim())
              : null,
            tokenExpiresAt: expiresAt,
            proxyEnabled,
            proxyProtocol: proxyEnabled ? proxyProtocol : null,
            proxyHost: proxyEnabled ? proxyHost : null,
            proxyPort: proxyEnabled ? Math.floor(proxyPort) : null,
            proxyUsername: proxyEnabled ? proxyUsername : null,
            proxyPasswordEncrypted: proxyEnabled
              ? proxyPassword
                ? encryptSecret(proxyPassword)
                : existing?.proxyPasswordEncrypted ?? null
              : null
          }
        });

        const tags = normalize(item.tags);
        const groups = normalize(item.groups);

        await tx.accountTag.deleteMany({
          where: {
            accountId: upserted.id
          }
        });
        for (const tagName of tags) {
          const tag = await tx.tag.upsert({
            where: {
              name: tagName
            },
            update: {},
            create: {
              name: tagName
            }
          });
          await tx.accountTag.create({
            data: {
              accountId: upserted.id,
              tagId: tag.id
            }
          });
        }

        await tx.accountGroupMember.deleteMany({
          where: {
            accountId: upserted.id
          }
        });
        for (const groupName of groups) {
          const group = await tx.accountGroup.upsert({
            where: {
              name: groupName
            },
            update: {},
            create: {
              name: groupName
            }
          });
          await tx.accountGroupMember.create({
            data: {
              accountId: upserted.id,
              groupId: group.id
            }
          });
        }

        return upserted;
      });

      report.push({
        xUserId,
        username: account.username,
        accountId: account.id,
        status: "ok"
      });
    }

    return NextResponse.json({
      data: report
    });
  } catch (error) {
    return serverError(error);
  }
}
