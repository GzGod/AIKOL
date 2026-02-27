import { NextResponse } from "next/server";

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json(
    {
      error: "bad_request",
      message,
      details
    },
    {
      status: 400
    }
  );
}

export function serverError(error: unknown) {
  const message = error instanceof Error ? error.message : "服务器内部错误";
  return NextResponse.json(
    {
      error: "internal_error",
      message
    },
    {
      status: 500
    }
  );
}
