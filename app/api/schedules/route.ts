import { ScheduleStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { badRequest, serverError } from "@/lib/http";

type SchedulePayload = {
  accountId?: string;
  contentId?: string;
  contentVariantId?: string;
  plannedAt?: string;
  priority?: number;
  maxAttempts?: number;
  idempotencyKey?: string;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    const limit = Math.max(1, Math.min(300, Number(searchParams.get("limit") || 120)));
    const statusFilter =
      statusParam &&
      Object.values(ScheduleStatus).includes(statusParam as ScheduleStatus)
        ? (statusParam as ScheduleStatus)
        : null;

    const rows = await db.schedule.findMany({
      where: statusFilter
        ? {
            status: statusFilter
          }
        : undefined,
      include: {
        account: {
          select: {
            id: true,
            username: true,
            status: true
          }
        },
        content: {
          select: {
            id: true,
            title: true,
            topic: true
          }
        },
        variant: {
          select: {
            id: true,
            body: true
          }
        }
      },
      orderBy: [
        {
          plannedAt: "asc"
        },
        {
          createdAt: "desc"
        }
      ],
      take: limit
    });

    return NextResponse.json({
      data: rows.map((row) => ({
        id: row.id,
        status: row.status,
        plannedAt: row.plannedAt.toISOString(),
        postedAt: row.postedAt?.toISOString() ?? null,
        nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
        account: row.account,
        content: row.content,
        variantPreview: row.variant.body.slice(0, 160),
        attemptCount: row.attemptCount,
        maxAttempts: row.maxAttempts,
        lastError: row.lastError,
        priority: row.priority
      }))
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as SchedulePayload;
    const accountId = payload.accountId?.trim();
    const contentId = payload.contentId?.trim();
    const variantId = payload.contentVariantId?.trim();
    const plannedAtRaw = payload.plannedAt?.trim();
    if (!accountId || !contentId || !variantId || !plannedAtRaw) {
      return badRequest("accountId、contentId、contentVariantId、plannedAt 均为必填项。");
    }
    const plannedAt = new Date(plannedAtRaw);
    if (Number.isNaN(plannedAt.getTime())) {
      return badRequest("plannedAt 不合法。");
    }
    const priority = Math.max(1, Math.min(1000, Math.floor(payload.priority ?? 100)));
    const maxAttempts = Math.max(1, Math.min(8, Math.floor(payload.maxAttempts ?? 3)));
    const idempotencyKey =
      payload.idempotencyKey?.trim() ||
      `${contentId}:${accountId}:${variantId}:${plannedAt.toISOString()}`;

    const schedule = await db.schedule.create({
      data: {
        accountId,
        contentId,
        contentVariantId: variantId,
        plannedAt,
        priority,
        maxAttempts,
        idempotencyKey
      }
    });

    await db.activityLog.create({
      data: {
        level: "INFO",
        event: "schedule_created",
        message: `已为账号 ${accountId} 创建排程。`,
        accountId,
        scheduleId: schedule.id
      }
    });

    return NextResponse.json({
      data: {
        id: schedule.id
      }
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        {
          error: "duplicate_schedule",
          message: "idempotencyKey 已存在。"
        },
        {
          status: 409
        }
      );
    }
    return serverError(error);
  }
}
