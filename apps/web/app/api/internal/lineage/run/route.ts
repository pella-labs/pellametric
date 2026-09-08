// POST /api/internal/lineage/run  body: { prId }
// Bearer INTERNAL_API_SECRET (or _PREVIOUS during rotation).
// Synchronously runs lineage for the given PR. Webhook hot path calls this.

import { NextResponse } from "next/server";
import { runLineageForPr } from "@/lib/lineage/run";
import { checkInternalSecret } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { systemHealth } from "@/lib/db/schema";

export async function POST(req: Request): Promise<NextResponse> {
  if (!checkInternalSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { prId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.prId) {
    return NextResponse.json({ error: "prId required" }, { status: 400 });
  }

  const started = Date.now();
  try {
    const result = await runLineageForPr(body.prId);
    const ms = Date.now() - started;
    await db
      .insert(systemHealth)
      .values({
        component: "lineage_worker",
        lastRunAt: new Date(),
        lastRunStatus: "ok",
        payload: { mode: "run", ms, ...result },
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemHealth.component,
        set: {
          lastRunAt: new Date(),
          lastRunStatus: "ok",
          payload: { mode: "run", ms, ...result },
          updatedAt: new Date(),
        },
      });
    return NextResponse.json({ ok: true, ms, ...result });
  } catch (err) {
    await db
      .insert(systemHealth)
      .values({
        component: "lineage_worker",
        lastRunAt: new Date(),
        lastRunStatus: "error",
        payload: { mode: "run", prId: body.prId, error: String(err) },
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemHealth.component,
        set: {
          lastRunAt: new Date(),
          lastRunStatus: "error",
          payload: { mode: "run", prId: body.prId, error: String(err) },
          updatedAt: new Date(),
        },
      });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
