import { ContentStatus, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { badRequest, serverError } from "@/lib/http";
import { buildSimilarityKey } from "@/lib/risk";
import { buildVariantBody, buildVariantKey } from "@/lib/variants";

type ContentPayload = {
  title?: string;
  body?: string;
  topic?: string;
  language?: string;
  status?: ContentStatus;
  targetAccountIds?: string[];
  autoVariants?: boolean;
};

export async function GET() {
  try {
    const rows = await db.content.findMany({
      include: {
        variants: {
          include: {
            account: {
              select: {
                id: true,
                username: true
              }
            }
          },
          orderBy: {
            createdAt: "asc"
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
      },
      take: 120
    });

    return NextResponse.json({
      data: rows.map((row) => ({
        id: row.id,
        title: row.title,
        topic: row.topic,
        language: row.language,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        scheduleCount: row._count.schedules,
        variants: row.variants.map((variant) => ({
          id: variant.id,
          accountId: variant.accountId,
          accountUsername: variant.account?.username ?? null,
          body: variant.body,
          createdAt: variant.createdAt.toISOString()
        }))
      }))
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as ContentPayload;
    const title = payload.title?.trim();
    const body = payload.body?.trim();
    if (!title || !body) {
      return badRequest("title and body are required.");
    }

    const status =
      payload.status === ContentStatus.APPROVED || payload.status === ContentStatus.ARCHIVED
        ? payload.status
        : ContentStatus.DRAFT;
    const targetAccountIds = Array.isArray(payload.targetAccountIds)
      ? Array.from(
          new Set(
            payload.targetAccountIds
              .map((item) => String(item).trim())
              .filter(Boolean)
          )
        )
      : [];

    const result = await db.$transaction(async (tx) => {
      const content = await tx.content.create({
        data: {
          title,
          body,
          topic: payload.topic?.trim() || null,
          language: payload.language?.trim() || null,
          status
        }
      });

      const variantsData: Prisma.ContentVariantCreateManyInput[] = [
        {
          contentId: content.id,
          body,
          similarityKey: buildSimilarityKey(body)
        }
      ];

      if (payload.autoVariants && targetAccountIds.length > 0) {
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
        accounts.forEach((account, index) => {
          const variantBody = buildVariantBody(body, account, index + 1);
          variantsData.push({
            contentId: content.id,
            accountId: account.id,
            body: variantBody,
            similarityKey: buildVariantKey(variantBody)
          });
        });
      }

      await tx.contentVariant.createMany({
        data: variantsData
      });

      await tx.activityLog.create({
        data: {
          level: "INFO",
          event: "content_created",
          message: `Content "${title}" created.`,
          meta: {
            autoVariants: Boolean(payload.autoVariants),
            targetAccounts: targetAccountIds.length
          }
        }
      });

      return content;
    });

    return NextResponse.json({
      data: result
    });
  } catch (error) {
    return serverError(error);
  }
}
