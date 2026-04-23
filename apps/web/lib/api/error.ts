import { NextResponse } from "next/server";

export type ApiError = { error: string; detail?: string };

/**
 * Unified error response helper. HTTP status lives on `NextResponse`;
 * the body carries only `{ error, detail? }` so clients read status from
 * the response object and a short human-readable code from the body.
 */
export function apiError(error: string, detail?: string, status = 400) {
  const body: ApiError = detail ? { error, detail } : { error };
  return NextResponse.json(body, { status });
}
