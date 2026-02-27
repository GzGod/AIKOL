import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { badRequest, serverError } from "@/lib/http";
import { buildVariantBody, buildVariantKey } from "@/lib/variants";

type DispatchPayload = {
  contentId?: string;
  mode?: "manual" | "rule";
  accountIds?: string[];
  scheduleAt?: string;
  staggerMinutes?: number;
  priority?: number;
};

function parseDate(input?: string): Date {
  if (!input || !input.trim()) {
    return new Date();
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error("invalid_scheduleAt");
  }
  return date;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function buildIdempotencyKey(contentId: string, accountId: string, plannedAt: Date): string {
  return `${contentId}:${accountId}:${plannedAt.toISOString()}`;
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as DispatchPayload;
    const contentId = payload.contentId?.trim();
    if (!contentId) {
      return badRequest("contentId is required.");
    }

    const content = await db.content.findUnique({
      where: {
        id: contentId
      }
    });
    if (!content) {
      return NextResponse.json(
        {
          error: "not_found",
          message: "content not found"
        },
        {
          status: 404
        }
      );
    }

    const mode = payload.mode === "manual" ? "manual" : "rule";
    let targetAccountIds: string[] = [];

    if (mode === "manual") {
      targetAccountIds = Array.isArray(payload.accountIds)
        ? Array.from(
            new Set(
              payload.accountIds
                .map((item) => String(item).trim())
                .filter(Boolean)
            )
          )
        : [];
      if (targetAccountIds.length === 0) {
        return badRequest("accountIds are required in manual mode.");
      }
    } else {
      const candidates = await db.account.findMany({
        include: {
          tagLinks: {
            include: {
              tag: true
            }
          }
        }
      });
      const topic = content.topic?.trim().toLowerCase() ?? "";
      const language = content.language?.trim().toLowerCase() ?? "";

      const matched = candidates.filter((account) => {
        const hasTopicTag =
          topic.length > 0 &&
          account.tagLinks.some((link) => link.tag.name.toLowerCase() === topic);
        const hasLanguageMatch =
          language.length > 0 &&
          !!account.language &&
          account.language.toLowerCase() === language;
        return hasTopicTag || hasLanguageMatch;
      });

      targetAccountIds = matched.map((account) => account.id);
      if (targetAccountIds.length === 0) {
        return badRequest(
          "No accounts matched routing rules. Add topic tags or language on accounts."
        );
      }
    }

    const plannedAt = parseDate(payload.scheduleAt);
    const staggerMinutes = Math.max(0, Math.min(120, Math.floor(payload.staggerMinutes ?? 20)));
    const priority = Math.max(1, Math.min(1000, Math.floor(payload.priority ?? 100)));

    const result = await db.$transaction(async (tx) => {
      const accounts = await tx.account.findMany({
        where: {
          id: {
            in: targetAccountIds
          }
        },
        select: {
          id: true,
          username: true,
          language: true
        }
      });

      const created: Array<{
        scheduleId: string;
        accountId: string;
        accountUsername: string;
        plannedAt: string;
      }> = [];

      let index = 0;
      for (const account of accounts) {
        let variant = await tx.contentVariant.findFirst({
          where: {
            contentId,
            accountId: account.id
          }
        });
        if (!variant) {
          const variantBody = buildVariantBody(content.body, account, index + 1);
          variant = await tx.contentVariant.create({
            data: {
              contentId,
              accountId: account.id,
              body: variantBody,
              similarityKey: buildVariantKey(variantBody)
            }
          });
        }

        const rowPlannedAt = addMinutes(plannedAt, staggerMinutes * index);
        index += 1;
        const idempotencyKey = buildIdempotencyKey(contentId, account.id, rowPlannedAt);

        try {
          const schedule = await tx.schedule.create({
            data: {
              accountId: account.id,
              contentId,
              contentVariantId: variant.id,
              plannedAt: rowPlannedAt,
              idempotencyKey,
              priority
            }
          });
          created.push({
            scheduleId: schedule.id,
            accountId: account.id,
            accountUsername: account.username,
            plannedAt: schedule.plannedAt.toISOString()
          });
        } catch (error) {
          if (
            typeof error === "object" &&
            error &&
            "code" in error &&
            (error as { code?: string }).code === "P2002"
          ) {
            continue;
          }
          throw error;
        }
      }

      await tx.activityLog.create({
        data: {
          level: "INFO",
          event: "content_dispatched",
          message: `Content "${content.title}" dispatched to ${created.length} accounts.`,
          meta: {
            mode,
            staggerMinutes,
            priority
          }
        }
      });

      return created;
    });

    return NextResponse.json({
      data: {
        created: result.length,
        schedules: result
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_scheduleAt") {
      return badRequest("scheduleAt must be a valid datetime.");
    }
    return serverError(error);
  }
}
