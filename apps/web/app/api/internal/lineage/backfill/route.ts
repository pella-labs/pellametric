// F4.30 / T6.2 — Resumable backfill of merged PRs for a freshly-installed org.
// Reads up to N PRs per invocation, hydrates them through the standard
// pr/pr_commit pipeline, enqueues lineage_job for each. Resumable via
// backfill_state (orgId, lastDay, status).
//
// Bearer INTERNAL_API_SECRET. Body: { orgId, limit? (default 25), windowDays? (default 30) }
//
// Rate-limit: sleeps 1s between PRs to stay polite to the GitHub REST API.

import { NextResponse } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { checkInternalSecret } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { org, pr as prTbl, backfillState, lineageJob } from "@/lib/db/schema";
import { appFetch } from "@/lib/github-app";
import { hydratePrFromWebhook } from "@/lib/github-pr-hydrate";

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

export async function POST(req: Request) {
  if (!checkInternalSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { orgId?: string; limit?: number; windowDays?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });
  const limit = Math.max(1, Math.min(100, body.limit ?? 25));
  const windowDays = Math.max(7, Math.min(365, body.windowDays ?? 30));

  const orgRow = await db.query.org.findFirst({ where: eq(org.id, body.orgId) });
  if (!orgRow) return NextResponse.json({ error: "org not found" }, { status: 404 });
  if (!orgRow.githubAppInstallationId) {
    return NextResponse.json({ error: "no installation" }, { status: 400 });
  }
  const installationId = orgRow.githubAppInstallationId;

  // Mark backfill running. Resumable cursor.
  const [state] = await db
    .select()
    .from(backfillState)
    .where(eq(backfillState.orgId, body.orgId))
    .limit(1);
  if (state?.status === "done") {
    return NextResponse.json({ ok: true, status: "done", note: "already backfilled" });
  }

  await db
    .insert(backfillState)
    .values({ orgId: body.orgId, status: "running", lastDay: state?.lastDay ?? null })
    .onConflictDoUpdate({
      target: backfillState.orgId,
      set: { status: "running", updatedAt: new Date() },
    });

  // List repos visible to the installation.
  const reposRes = await appFetch(installationId, `/installation/repositories?per_page=100`);
  if (!reposRes.ok) {
    await db
      .update(backfillState)
      .set({ status: "error", updatedAt: new Date() })
      .where(eq(backfillState.orgId, body.orgId));
    return NextResponse.json({ error: "list repos failed", status: reposRes.status }, { status: 502 });
  }
  const reposJson = (await reposRes.json()) as { repositories?: Array<{ full_name: string }> };
  const repos = reposJson.repositories ?? [];

  const since = new Date(Date.now() - windowDays * 86_400_000);
  let processed = 0;
  let hydrated = 0;
  let skipped = 0;
  const sinceIso = since.toISOString();

  outer:
  for (const repo of repos) {
    if (processed >= limit) break;
    // Use `is:pr is:merged` search to grab recent merged PRs.
    const sr = await appFetch(
      installationId,
      `/search/issues?q=${encodeURIComponent(`repo:${repo.full_name} is:pr is:merged merged:>=${sinceIso.slice(0, 10)}`)}&sort=updated&order=desc&per_page=${Math.min(50, limit - processed)}`,
    );
    if (!sr.ok) continue;
    const sj = (await sr.json()) as { items?: Array<{ number: number }> };
    for (const item of sj.items ?? []) {
      if (processed >= limit) break outer;
      processed++;
      // Skip if we already have it locally.
      const [existing] = await db
        .select({ id: prTbl.id })
        .from(prTbl)
        .where(and(eq(prTbl.orgId, body.orgId), eq(prTbl.repo, repo.full_name), eq(prTbl.number, item.number)))
        .limit(1);
      if (existing) {
        skipped++;
        await db.insert(lineageJob).values({
          prId: existing.id,
          reason: "backfill",
          priority: 3,
          scheduledFor: new Date(),
          status: "pending",
        });
        continue;
      }
      // Pull full PR.
      const pr = await appFetch(installationId, `/repos/${repo.full_name}/pulls/${item.number}`);
      if (!pr.ok) continue;
      const prPayload = (await pr.json()) as Parameters<typeof hydratePrFromWebhook>[2];
      try {
        await hydratePrFromWebhook(
          { orgId: body.orgId, installationId, useCursor: false },
          { full_name: repo.full_name },
          prPayload,
        );
        hydrated++;
      } catch (err) {
        console.error("hydrate failed", { repo: repo.full_name, number: item.number, err });
      }
      // 1 PR / sec rate limit.
      await sleep(1000);
    }
  }

  const status = processed < limit ? "done" : "running";
  await db
    .update(backfillState)
    .set({ status, lastDay: new Date().toISOString().slice(0, 10), updatedAt: new Date() })
    .where(eq(backfillState.orgId, body.orgId));

  void gte; // typed import keeps drizzle helper available if extended later
  return NextResponse.json({
    ok: true,
    orgId: body.orgId,
    status,
    processed,
    hydrated,
    skipped,
  });
}
