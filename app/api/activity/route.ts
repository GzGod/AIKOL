import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { serverError } from "@/lib/http";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(200, Number(searchParams.get("limit") || 80)));
    const logs = await db.activityLog.findMany({
      orderBy: {
        createdAt: "desc"
      },
      take: limit
    });
    return NextResponse.json({
      data: logs.map((log) => ({
        id: log.id,
        level: log.level,
        event: log.event,
        message: log.message,
        accountId: log.accountId,
        scheduleId: log.scheduleId,
        createdAt: log.createdAt.toISOString(),
        meta: log.meta
      }))
    });
  } catch (error) {
    return serverError(error);
  }
}
