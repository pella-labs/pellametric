// F4.32 / T2.5 — Manager-triggered re-run of lineage for one PR. Enqueues a
// high-priority lineage_job that the next /run or /sweep cycle picks up.
// Manager-only — the caller must have a manager membership in the PR's org.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pr, membership, lineageJob } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function POST(_req: Request, { params }: { params: Promise<{ prId: string }> }) {
  const { prId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [prRow] = await db.select().from(pr).where(eq(pr.id, prId)).limit(1);
  if (!prRow) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [mem] = await db
    .select()
    .from(membership)
    .where(and(eq(membership.userId, session.user.id), eq(membership.orgId, prRow.orgId)))
    .limit(1);
  if (!mem || mem.role !== "manager") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await db.insert(lineageJob).values({
    prId,
    reason: "manual_relink",
    priority: 1,
    scheduledFor: new Date(),
    status: "pending",
  });
  return NextResponse.json({ ok: true, prId, queued: true });
}
