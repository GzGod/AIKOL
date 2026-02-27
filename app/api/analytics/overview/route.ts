import { NextRequest, NextResponse } from "next/server";
import { buildAnalyticsOverview } from "@/lib/analytics";
import { serverError } from "@/lib/http";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.max(1, Math.min(180, Number(searchParams.get("days") || 30)));
    const data = await buildAnalyticsOverview(days);
    return NextResponse.json({
      data
    });
  } catch (error) {
    return serverError(error);
  }
}
