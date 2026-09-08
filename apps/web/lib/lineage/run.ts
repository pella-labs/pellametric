// Phase 2 lineage worker — given a prId, compute session_pr_link rows from
// candidate sessions (cwd repo match, time window ±48h). Writes high/medium/
// low buckets; drops sub-threshold.
//
// Called from /api/internal/lineage/run (webhook hot path) and
// /api/internal/lineage/sweep (cron safety net).

import { db } from "@/lib/db";
import { pr, prCommit, sessionEvent, sessionPrLink, org, user } from "@/lib/db/schema";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { scoreLineage, type PrCommit } from "@/lib/lineage/score";
import { refreshCostPerPr } from "@/lib/insights/refresh-cost-per-pr";
import { refreshDailyUserStats } from "@/lib/insights/refresh-daily-user-stats";
import { refreshDailyOrgStats } from "@/lib/insights/refresh-daily-org-stats";

export type LineageRunResult = {
  prId: string;
  linksCreated: number;
  linksUpdated: number;
  candidates: number;
  dropped: number;
};

const TIME_WINDOW_HOURS = 48;

export async function runLineageForPr(prId: string): Promise<LineageRunResult> {
  const prRow = await db.query.pr.findFirst({ where: eq(pr.id, prId) });
  if (!prRow) return { prId, linksCreated: 0, linksUpdated: 0, candidates: 0, dropped: 0 };

  const orgRow = await db.query.org.findFirst({ where: eq(org.id, prRow.orgId) });
  if (!orgRow) return { prId, linksCreated: 0, linksUpdated: 0, candidates: 0, dropped: 0 };

  // Candidate sessions: same org, ended within ±48h of PR createdAt or mergedAt.
  const windowMs = TIME_WINDOW_HOURS * 3600 * 1000;
  const windowStart = new Date(prRow.createdAt.getTime() - windowMs);
  const windowEnd = new Date((prRow.mergedAt ?? prRow.createdAt).getTime() + windowMs);

  const candidates = await db
    .select()
    .from(sessionEvent)
    .where(
      and(
        eq(sessionEvent.orgId, prRow.orgId),
        gte(sessionEvent.endedAt, windowStart),
        lte(sessionEvent.endedAt, windowEnd),
      ),
    );

  if (candidates.length === 0) {
    await db
      .update(pr)
      .set({ linkComputedAt: new Date() })
      .where(eq(pr.id, prId));
    return { prId, linksCreated: 0, linksUpdated: 0, candidates: 0, dropped: 0 };
  }

  // Fetch pr_commit rows for authorship signal.
  const commits = await db
    .select()
    .from(prCommit)
    .where(eq(prCommit.prId, prId));
  const prCommitsTyped: PrCommit[] = commits
    .filter(c => c.kind === "commit" || c.kind === "squash_merge" || c.kind === "merge_commit")
    .map(c => ({
      sha: c.sha,
      kind: c.kind as PrCommit["kind"],
      authorLogin: c.authorLogin,
      authoredAt: c.authoredAt,
    }));

  // Resolve per-user githubLogin in one batch (used by authorship signal).
  const userIds = Array.from(new Set(candidates.map(c => c.userId)));
  const userRows = userIds.length > 0
    ? await db.select({ id: user.id, githubLogin: user.githubLogin }).from(user).where(inArray(user.id, userIds))
    : [];
  const loginByUser = new Map(userRows.map(u => [u.id, u.githubLogin]));

  let linksCreated = 0;
  let linksUpdated = 0;
  let dropped = 0;

  // C5 fix: thread pr.previous_filenames into scoreLineage so renamed files
  // expand the Jaccard target set (P10).
  const prevFilenames = (prRow.previousFilenames as string[]) ?? [];

  for (const c of candidates) {
    const result = scoreLineage(
      {
        startedAt: c.startedAt,
        endedAt: c.endedAt,
        filesEdited: (c.filesEdited as string[]) ?? [],
        branch: c.branch,
        cwdResolvedRepo: c.cwdResolvedRepo,
      },
      {
        repo: prRow.repo,
        fileList: (prRow.fileList as string[]) ?? [],
        createdAt: prRow.createdAt,
        mergedAt: prRow.mergedAt,
        headBranch: prRow.headBranch,
      },
      prCommitsTyped,
      loginByUser.get(c.userId) ?? null,
      prevFilenames,
    );

    if (result.bucket === "drop") {
      dropped++;
      continue;
    }

    const fileJaccardPct = Math.round(result.fileJaccard * 100);
    const confScore = Math.round(result.score * 100);
    const timeOverlapLabel =
      result.reasonBreakdown.timeRaw === 1
        ? "within_pr_window"
        : result.reasonBreakdown.timeRaw === 0.5
          ? c.endedAt.getTime() < prRow.createdAt.getTime()
            ? "pre_pr"
            : "post_pr"
          : "none";

    const values = {
      sessionEventId: c.id,
      prId,
      fileOverlap: fileJaccardPct,
      confidence: result.bucket,
      fileJaccard: fileJaccardPct,
      timeOverlap: timeOverlapLabel,
      cwdMatch: result.cwdMatch,
      branchMatch: result.branchMatch,
      confidenceScore: confScore,
      confidenceReason: result.reasonBreakdown,
      linkSource: "auto" as const,
      updatedAt: new Date(),
    };

    const upserted = await db
      .insert(sessionPrLink)
      .values(values)
      .onConflictDoUpdate({
        target: [sessionPrLink.sessionEventId, sessionPrLink.prId],
        set: {
          fileOverlap: values.fileOverlap,
          confidence: values.confidence,
          fileJaccard: values.fileJaccard,
          timeOverlap: values.timeOverlap,
          cwdMatch: values.cwdMatch,
          branchMatch: values.branchMatch,
          confidenceScore: values.confidenceScore,
          confidenceReason: values.confidenceReason,
          updatedAt: values.updatedAt,
        },
      })
      .returning({ sessionEventId: sessionPrLink.sessionEventId, createdAt: sessionPrLink.createdAt });

    const row = upserted[0];
    if (!row) continue;
    // createdAt was just set by defaultNow on insert; for the update path it
    // would be the existing value. Heuristic: if createdAt is within 1s of now,
    // treat as create.
    const ageMs = Date.now() - row.createdAt.getTime();
    if (ageMs < 1000) linksCreated++;
    else linksUpdated++;
  }

  await db
    .update(pr)
    .set({ linkComputedAt: new Date() })
    .where(eq(pr.id, prId));

  // Trigger rollups (Phase 3 wiring, T3.5). Best-effort — log + continue on fail.
  try {
    await refreshCostPerPr(prId);
  } catch (err) {
    console.error("refreshCostPerPr failed", err);
  }
  // Collect distinct (userId, day) pairs from the candidate sessions we linked.
  const userDays = new Map<string, Set<string>>();
  for (const c of candidates) {
    const userId = c.userId;
    if (!userDays.has(userId)) userDays.set(userId, new Set());
    const days = userDays.get(userId)!;
    days.add(c.startedAt.toISOString().slice(0, 10));
    days.add(c.endedAt.toISOString().slice(0, 10));
  }
  const orgDays = new Set<string>();
  for (const [userId, days] of userDays) {
    try {
      await refreshDailyUserStats(userId, prRow.orgId, Array.from(days));
      for (const d of days) orgDays.add(d);
    } catch (err) {
      console.error("refreshDailyUserStats failed", { userId, err });
    }
  }
  for (const d of orgDays) {
    try {
      await refreshDailyOrgStats(prRow.orgId, d);
    } catch (err) {
      console.error("refreshDailyOrgStats failed", { day: d, err });
    }
  }

  return { prId, linksCreated, linksUpdated, candidates: candidates.length, dropped };
}

/**
 * Drain up to `limit` jobs from lineage_job by (priority asc, scheduledFor asc).
 * H6 fix: claim each job atomically with FOR UPDATE SKIP LOCKED so concurrent
 * /run + /sweep callers cannot pick the same job. The previous
 * SELECT-then-UPDATE was a TOCTOU race.
 */
export async function drainLineageJobs(limit: number): Promise<LineageRunResult[]> {
  const { lineageJob } = await import("@/lib/db/schema");
  const results: LineageRunResult[] = [];

  for (let i = 0; i < limit; i++) {
    // Single atomic claim. Returns at most one row.
    const claimed = await db.execute<{ id: string; pr_id: string }>(sql`
      UPDATE lineage_job
      SET status = 'running',
          attempts = attempts + 1,
          updated_at = now()
      WHERE id = (
        SELECT id FROM lineage_job
        WHERE status = 'pending' AND scheduled_for <= now()
        ORDER BY priority ASC, scheduled_for ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, pr_id
    `);
    // drizzle returns { rows } for node-postgres but raw array for postgres-js;
    // tolerate either shape.
    const rows = Array.isArray(claimed) ? claimed : (claimed as { rows?: unknown[] }).rows ?? [];
    const job = rows[0] as { id: string; pr_id: string } | undefined;
    if (!job) break;

    try {
      const r = await runLineageForPr(job.pr_id);
      await db
        .update(lineageJob)
        .set({ status: "done", updatedAt: new Date() })
        .where(eq(lineageJob.id, job.id));
      results.push(r);
    } catch (err) {
      await db
        .update(lineageJob)
        .set({ status: "failed", lastError: String(err), updatedAt: new Date() })
        .where(eq(lineageJob.id, job.id));
    }
  }
  return results;
}
