// GET /api/health/lineage
// Public health endpoint. Returns 503 if last heartbeat is older than 90 min.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { systemHealth } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const STALE_MS = 90 * 60 * 1000;

export async function GET(): Promise<NextResponse> {
  const row = await db.query.systemHealth.findFirst({
    where: eq(systemHealth.component, "lineage_worker"),
  });
  if (!row) {
    return NextResponse.json({ ok: false, reason: "no heartbeat yet" }, { status: 503 });
  }
  const ageMs = Date.now() - row.lastRunAt.getTime();
  if (ageMs > STALE_MS) {
    return NextResponse.json(
      { ok: false, reason: "stale", lastRunAt: row.lastRunAt, ageMs },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    status: row.lastRunStatus,
    lastRunAt: row.lastRunAt,
    ageMs,
    payload: row.payload,
  });
}
