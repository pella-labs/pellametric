// F4.33 / T7.5 — Cohort intersection guard. Scheduled detector (cron / external
// scheduler hits this endpoint hourly) that scans cohort_query_log for the
// same manager making different-cohort queries whose member-set intersection
// is ≥ (k-1). If so, posts to LINEAGE_ALERT_WEBHOOK.
//
// Bearer INTERNAL_API_SECRET.

import { NextResponse } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { cohortQueryLog } from "@/lib/db/schema";
import { checkInternalSecret } from "@/lib/auth-middleware";

const LOOKBACK_HOURS = 24;
const K = 5;
const THRESHOLD = K - 1; // 4 overlapping members triggers the alert

export async function POST(req: Request) {
  if (!checkInternalSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const logs = await db
    .select()
    .from(cohortQueryLog)
    .where(gte(cohortQueryLog.queriedAt, since));

  // Group by manager.
  const byMgr = new Map<string, typeof logs>();
  for (const r of logs) {
    if (!byMgr.has(r.managerId)) byMgr.set(r.managerId, []);
    byMgr.get(r.managerId)!.push(r);
  }

  type Hit = {
    managerId: string;
    a: { metric: string; cohortHash: string; queriedAt: Date };
    b: { metric: string; cohortHash: string; queriedAt: Date };
    intersection: number;
  };
  const hits: Hit[] = [];
  for (const [managerId, rows] of byMgr) {
    if (rows.length < 2) continue;
    // O(n^2) compare. n is tiny per-window.
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i];
        const b = rows[j];
        if (a.cohortHash === b.cohortHash) continue;
        const ai = new Set(a.memberIds);
        let inter = 0;
        for (const x of b.memberIds) if (ai.has(x)) inter++;
        if (inter >= THRESHOLD) {
          hits.push({
            managerId,
            a: { metric: a.metric, cohortHash: a.cohortHash, queriedAt: a.queriedAt },
            b: { metric: b.metric, cohortHash: b.cohortHash, queriedAt: b.queriedAt },
            intersection: inter,
          });
        }
      }
    }
  }

  if (hits.length > 0) {
    const webhookUrl = process.env.LINEAGE_ALERT_WEBHOOK;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: `Pellametric cohort intersection alert: ${hits.length} pair(s) over ${THRESHOLD} overlap. Lookback ${LOOKBACK_HOURS}h.`,
            hits: hits.slice(0, 25),
          }),
        });
      } catch (err) {
        console.error("cohort alert webhook failed", err);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    lookbackHours: LOOKBACK_HOURS,
    managersInspected: byMgr.size,
    hits: hits.length,
  });
}
