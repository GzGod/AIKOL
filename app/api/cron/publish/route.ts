import { NextRequest, NextResponse } from "next/server";
import { runPublisherCycle } from "@/lib/scheduler";
import { badRequest, serverError } from "@/lib/http";

function checkSecret(request: NextRequest): boolean {
  const configured = (process.env.CRON_SECRET ?? "").trim();
  if (!configured) {
    return true;
  }
  const incomingHeader = request.headers.get("x-cron-secret")?.trim();
  if (incomingHeader === configured) {
    return true;
  }
  const authHeader = request.headers.get("authorization")?.trim() ?? "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim() === configured;
  }
  return false;
}

export async function POST(request: NextRequest) {
  try {
    if (!checkSecret(request)) {
      return NextResponse.json(
        {
          error: "unauthorized",
          message: "Invalid cron secret."
        },
        {
          status: 401
        }
      );
    }

    const payload =
      request.headers.get("content-type")?.includes("application/json")
        ? ((await request.json()) as { limit?: number })
        : {};
    const limit = Math.max(1, Math.min(200, Math.floor(payload.limit ?? 30)));
    if (!Number.isFinite(limit)) {
      return badRequest("limit must be numeric.");
    }
    const summary = await runPublisherCycle(limit);
    return NextResponse.json({
      data: summary
    });
  } catch (error) {
    return serverError(error);
  }
}
