// Hydrate pr + pr_commit rows from a webhook payload.
// pre-squash commits are written at opened/synchronize (P1).
// merge / squash commits are written at closed/merged (P2).

import { db } from "@/lib/db";
import {
  pr as prTbl,
  prCommit as prCommitTbl,
  lineageJob,
  org as orgTbl,
} from "@/lib/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { appFetch } from "@/lib/github-app";
import { redactCommitMessage } from "@/lib/lineage/redact";
import { scoreCommitAttribution, type CommitForAttribution } from "@/lib/lineage/attribute";
import { isAncestor } from "@/lib/github/ancestry";
import { installationToken } from "@/lib/github-app";

type PrPayload = {
  number: number;
  title: string | null;
  user: { login: string } | null;
  state: string;
  merged: boolean;
  merged_at: string | null;
  created_at: string;
  base: { ref: string };
  head: { ref: string };
  merge_commit_sha: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
  html_url: string;
};

type RepoPayload = { full_name: string };

type WebhookCtx = {
  orgId: string;
  installationId: number;
  useCursor: boolean;
};

function isRevertTitle(title: string | null, mergeMessage?: string): boolean {
  if (title && /^Revert\s+"/.test(title)) return true;
  if (mergeMessage && /This reverts commit [0-9a-f]{7,40}/i.test(mergeMessage)) return true;
  return false;
}

async function fetchPrCommits(installationId: number, repo: string, number: number): Promise<Array<{
  sha: string;
  authorLogin: string | null;
  authorEmail: string | null;
  authorName: string | null;
  committerEmail: string | null;
  message: string;
  additions: number;
  deletions: number;
  files: string[];
  authoredAt: Date;
}>> {
  const out: Array<any> = [];
  let page = 1;
  // GitHub returns 30 per page by default; cap at 250 to bound work.
  while (page <= 9) {
    const res = await appFetch(installationId, `/repos/${repo}/pulls/${number}/commits?per_page=100&page=${page}`);
    if (!res.ok) break;
    const items = (await res.json()) as any[];
    if (!items?.length) break;
    for (const it of items) {
      out.push({
        sha: it.sha,
        authorLogin: it.author?.login ?? null,
        authorEmail: it.commit?.author?.email ?? null,
        authorName: it.commit?.author?.name ?? null,
        committerEmail: it.commit?.committer?.email ?? null,
        message: it.commit?.message ?? "",
        additions: 0, // detail call needed for per-commit additions; left 0 in v1
        deletions: 0,
        files: [],
        authoredAt: new Date(it.commit?.author?.date ?? Date.now()),
      });
    }
    if (items.length < 100) break;
    page++;
  }
  return out;
}

async function fetchPrFiles(installationId: number, repo: string, number: number): Promise<{ files: string[]; previousFilenames: string[] }> {
  const files: string[] = [];
  const previousFilenames: string[] = [];
  let page = 1;
  while (page <= 4) {
    const res = await appFetch(installationId, `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
    if (!res.ok) break;
    const items = (await res.json()) as any[];
    if (!items?.length) break;
    for (const it of items) {
      files.push(it.filename);
      // P10: capture previous_filename when status='renamed' so a session that
      // edited the file under its old path still scores a Jaccard hit.
      if (it.status === "renamed" && typeof it.previous_filename === "string" && it.previous_filename.length > 0) {
        previousFilenames.push(it.previous_filename);
      }
    }
    if (items.length < 100) break;
    page++;
  }
  return { files, previousFilenames };
}

/**
 * Upserts a pr row + all pr_commit rows for kind='commit' (pre-squash, P1).
 * Idempotent on (orgId, repo, number).
 */
export async function hydratePrFromWebhook(
  ctx: WebhookCtx,
  repoPayload: RepoPayload,
  prPayload: PrPayload,
): Promise<{ prId: string }> {
  const repo = repoPayload.full_name;
  const { files: fileList, previousFilenames } = await fetchPrFiles(ctx.installationId, repo, prPayload.number);
  const state = prPayload.merged ? "merged" : prPayload.state;

  const kind = isRevertTitle(prPayload.title) ? "revert" : "standard";

  // Stacked PR detection: base ref matches another open PR's head ref in the same org+repo.
  let stackedOn: string | null = null;
  if (prPayload.base?.ref) {
    const parent = await db
      .select({ id: prTbl.id })
      .from(prTbl)
      .where(
        and(
          eq(prTbl.orgId, ctx.orgId),
          eq(prTbl.repo, repo),
          eq(prTbl.headBranch, prPayload.base.ref),
          eq(prTbl.state, "open"),
        ),
      )
      .limit(1);
    stackedOn = parent[0]?.id ?? null;
  }

  const upsertValues = {
    orgId: ctx.orgId,
    provider: "github" as const,
    repo,
    number: prPayload.number,
    title: prPayload.title,
    authorLogin: prPayload.user?.login ?? null,
    state,
    additions: prPayload.additions ?? 0,
    deletions: prPayload.deletions ?? 0,
    changedFiles: prPayload.changed_files ?? 0,
    commits: prPayload.commits ?? 0,
    createdAt: new Date(prPayload.created_at),
    mergedAt: prPayload.merged_at ? new Date(prPayload.merged_at) : null,
    url: prPayload.html_url,
    fileList,
    previousFilenames,
    updatedAt: new Date(),
    mergeCommitSha: prPayload.merge_commit_sha,
    baseBranch: prPayload.base.ref,
    headBranch: prPayload.head.ref,
    lastSyncedAt: new Date(),
    kind,
    stackedOn,
  };

  const inserted = await db
    .insert(prTbl)
    .values(upsertValues)
    .onConflictDoUpdate({
      target: [prTbl.orgId, prTbl.repo, prTbl.number],
      set: {
        title: upsertValues.title,
        state: upsertValues.state,
        additions: upsertValues.additions,
        deletions: upsertValues.deletions,
        changedFiles: upsertValues.changedFiles,
        commits: upsertValues.commits,
        mergedAt: upsertValues.mergedAt,
        fileList: upsertValues.fileList,
        previousFilenames: upsertValues.previousFilenames,
        updatedAt: upsertValues.updatedAt,
        mergeCommitSha: upsertValues.mergeCommitSha,
        baseBranch: upsertValues.baseBranch,
        headBranch: upsertValues.headBranch,
        lastSyncedAt: upsertValues.lastSyncedAt,
        kind: upsertValues.kind,
        stackedOn: upsertValues.stackedOn,
      },
    })
    .returning({ id: prTbl.id });
  const prId = inserted[0].id;

  // Hydrate pre-squash commits (kind='commit') (P1).
  const commits = await fetchPrCommits(ctx.installationId, repo, prPayload.number);
  if (commits.length > 0) {
    for (const c of commits) {
      const { redacted, wasRedacted } = redactCommitMessage(c.message);
      const attr = scoreCommitAttribution(
        {
          authorLogin: c.authorLogin,
          authorEmail: c.authorEmail,
          committerEmail: c.committerEmail,
          message: c.message,
          additions: c.additions,
          deletions: c.deletions,
          files: c.files,
        } satisfies CommitForAttribution,
        null,
        { useCursor: ctx.useCursor },
      );
      await db
        .insert(prCommitTbl)
        .values({
          prId,
          orgId: ctx.orgId,
          sha: c.sha,
          authorLogin: c.authorLogin,
          authorEmail: c.authorEmail,
          authorName: c.authorName,
          committerEmail: c.committerEmail,
          message: redacted,
          messageRedacted: wasRedacted,
          additions: c.additions,
          deletions: c.deletions,
          fileList: c.files,
          authoredAt: c.authoredAt,
          kind: "commit",
          aiSources: attr.aiSources,
          aiSignals: attr.aiSignals,
          aiConfidence: attr.aiConfidence,
        })
        .onConflictDoUpdate({
          target: [prCommitTbl.prId, prCommitTbl.sha],
          set: {
            message: redacted,
            messageRedacted: wasRedacted,
            aiSources: attr.aiSources,
            aiSignals: attr.aiSignals,
            aiConfidence: attr.aiConfidence,
          },
        });
    }
  }

  // On merge, hydrate the merge/squash commit too (P2).
  if (prPayload.merged && prPayload.merge_commit_sha) {
    try {
      const res = await appFetch(ctx.installationId, `/repos/${repo}/commits/${prPayload.merge_commit_sha}`);
      if (res.ok) {
        const c = (await res.json()) as any;
        const message: string = c.commit?.message ?? "";
        // If commits>1 and merge has no parent merge of the branch tip, it's a squash.
        const isSquash = (c.parents?.length ?? 1) === 1 && prPayload.commits > 1;
        const kind = isSquash ? "squash_merge" : "merge_commit";
        const { redacted, wasRedacted } = redactCommitMessage(message);
        const attr = scoreCommitAttribution(
          {
            authorLogin: c.author?.login ?? null,
            authorEmail: c.commit?.author?.email ?? null,
            committerEmail: c.commit?.committer?.email ?? null,
            message,
            additions: c.stats?.additions ?? 0,
            deletions: c.stats?.deletions ?? 0,
            files: (c.files ?? []).map((f: any) => f.filename),
          },
          null,
          { useCursor: ctx.useCursor },
        );
        await db
          .insert(prCommitTbl)
          .values({
            prId,
            orgId: ctx.orgId,
            sha: c.sha,
            authorLogin: c.author?.login ?? null,
            authorEmail: c.commit?.author?.email ?? null,
            authorName: c.commit?.author?.name ?? null,
            committerEmail: c.commit?.committer?.email ?? null,
            message: redacted,
            messageRedacted: wasRedacted,
            additions: c.stats?.additions ?? 0,
            deletions: c.stats?.deletions ?? 0,
            fileList: (c.files ?? []).map((f: any) => f.filename),
            authoredAt: new Date(c.commit?.author?.date ?? Date.now()),
            kind,
            aiSources: attr.aiSources,
            aiSignals: attr.aiSignals,
            aiConfidence: attr.aiConfidence,
          })
          .onConflictDoUpdate({
            target: [prCommitTbl.prId, prCommitTbl.sha],
            set: { kind, message: redacted, messageRedacted: wasRedacted },
          });

        // Revert detection on the merge commit (P5).
        if (isRevertTitle(prPayload.title, message)) {
          // Try to find reverted PR id by sha mentioned in message.
          const m = /This reverts commit ([0-9a-f]{7,40})/i.exec(message);
          if (m) {
            const revSha = m[1];
            const reverted = await db
              .select({ id: prTbl.id })
              .from(prTbl)
              .where(and(eq(prTbl.orgId, ctx.orgId), eq(prTbl.repo, repo)))
              .limit(500);
            // (Best-effort lookup; production uses pr_commit join.)
            for (const r of reverted) {
              const m2 = await db
                .select({ prId: prCommitTbl.prId })
                .from(prCommitTbl)
                .where(and(eq(prCommitTbl.prId, r.id), eq(prCommitTbl.sha, revSha)))
                .limit(1);
              if (m2[0]) {
                await db
                  .update(prTbl)
                  .set({ kind: "revert", revertsPrId: m2[0].prId })
                  .where(eq(prTbl.id, prId));
                break;
              }
            }
          }
        }
      }
    } catch {
      // best-effort
    }
  }

  // Enqueue lineage job (P15). Priority 1 = webhook hot path.
  await db.insert(lineageJob).values({
    prId,
    reason: prPayload.merged ? "pr_merged" : "pr_event",
    priority: 1,
    scheduledFor: new Date(),
    status: "pending",
  });

  return { prId };
}

/**
 * Force-push wipe + rehydrate (P3). If `before` is not an ancestor of `after`,
 * wipe the pr's commit rows of kind='commit' and re-hydrate from current API.
 */
export async function handleForcePush(
  ctx: WebhookCtx,
  repo: string,
  before: string,
  after: string,
  headBranch: string,
): Promise<void> {
  const token = await installationToken(ctx.installationId);
  const ancestor = await isAncestor(repo, before, after, token);
  if (ancestor) return; // ordinary push, nothing to do
  // Locate the open PR for this head branch.
  const open = await db
    .select({ id: prTbl.id, number: prTbl.number })
    .from(prTbl)
    .where(
      and(
        eq(prTbl.orgId, ctx.orgId),
        eq(prTbl.repo, repo),
        eq(prTbl.headBranch, headBranch),
        eq(prTbl.state, "open"),
      ),
    )
    .limit(1);
  const target = open[0];
  if (!target) return;
  // Wipe pre-squash commits and re-enqueue.
  await db
    .delete(prCommitTbl)
    .where(and(eq(prCommitTbl.prId, target.id), eq(prCommitTbl.kind, "commit")));
  await db.insert(lineageJob).values({
    prId: target.id,
    reason: "force_push",
    priority: 2,
    scheduledFor: new Date(),
    status: "pending",
  });
}
