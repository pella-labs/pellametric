// POST /api/internal/lineage/sweep  (Bearer INTERNAL_API_SECRET).
// Cron every 30 min. Drains lineage_job pending queue up to N=500.

import { NextResponse } from "next/server";
import { drainLineageJobs } from "@/lib/lineage/run";
import { checkInternalSecret } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { systemHealth } from "@/lib/db/schema";

const MAX = 500;

export async function POST(req: Request): Promise<NextResponse> {
  if (!checkInternalSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  try {
    const results = await drainLineageJobs(MAX);
    const ms = Date.now() - started;
    const payload = { mode: "sweep", drained: results.length, ms };
    await db
      .insert(systemHealth)
      .values({
        component: "lineage_worker",
        lastRunAt: new Date(),
        lastRunStatus: "ok",
        payload,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemHealth.component,
        set: { lastRunAt: new Date(), lastRunStatus: "ok", payload, updatedAt: new Date() },
      });
    return NextResponse.json({ ok: true, drained: results.length, ms });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
