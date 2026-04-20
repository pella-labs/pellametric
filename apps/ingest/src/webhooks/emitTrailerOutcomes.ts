// Trailer-based outcome emitter (CLAUDE.md §Outcome Attribution, Layer 2).
//
// Shared between the legacy `?org=<slug>` webhook router and the new
// installation-id webhook route: given a parsed GitHub webhook body and the
// event name, extract any `AI-Assisted: bematist-<sessionId>` trailers from
// the commits it carries and emit a row per (commit, trailer) to the
// OutcomesStore.
//
// Covered events:
//   · push                       — every commit in `commits[]`.
//   · pull_request.closed+merged — the merge commit only (head-of-PR commit
//     iteration belongs in reconcile since the webhook payload only ships
//     the merge commit on a merged PR; per-commit messages on a head branch
//     arrive via `push` when the branch is pushed, which we already cover).
//
// engineer_id resolution: the GitHub webhook shape gives us
// `commit.author.email` (push) or `pull_request.merged_by.login` (PR merge).
// We do NOT yet have an email→engineer_id mapping wired at ingest-time (that
// sits in the worker + Better Auth). We store `engineer_id=null` here and
// let the worker backfill later from `(org, author_email, committed_at)`.
// TODO(outcome-attribution): wire engineer_id mapping into ingest once the
// mapping table exposes a sync-read path.
//
// Logging invariant: commit messages contain prompt-adjacent text and MUST
// NOT appear verbatim in logs. We use `sanitizeCommitMessageForLog` to write
// `<truncated:N-chars>` markers only.

import { logger } from "../logger";
import type { OutcomesStore, TrailerSource } from "./outcomesStore";
import { parseAiAssistedTrailer, sanitizeCommitMessageForLog } from "./parseTrailer";

type Any = Record<string, unknown>;

export interface EmitTrailerOutcomesInput {
  orgId: string;
  event: string; // x-github-event
  body: unknown; // already JSON-parsed webhook body
  outcomesStore: OutcomesStore;
  /** Request correlation id for log lines. */
  requestId?: string;
}

export interface EmitTrailerOutcomesResult {
  /** Commits inspected for trailers (across all layers). */
  commitsInspected: number;
  /** Trailers successfully parsed. */
  trailersFound: number;
  /** Outcome rows actually inserted (post-idempotency). */
  outcomesInserted: number;
}

const EMPTY: EmitTrailerOutcomesResult = {
  commitsInspected: 0,
  trailersFound: 0,
  outcomesInserted: 0,
};

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Emit outcomes for trailer-bearing commits on a webhook body. Never throws —
 * malformed payloads log + return the zero result so the webhook HTTP path
 * stays on the happy leg.
 */
export async function emitTrailerOutcomes(
  input: EmitTrailerOutcomesInput,
): Promise<EmitTrailerOutcomesResult> {
  try {
    if (input.event === "push") return await handlePush(input);
    if (input.event === "pull_request") return await handlePullRequest(input);
    return EMPTY;
  } catch (err) {
    logger.warn(
      {
        event: input.event,
        request_id: input.requestId,
        err: err instanceof Error ? err.message : String(err),
      },
      "emitTrailerOutcomes failed",
    );
    return EMPTY;
  }
}

async function handlePush(input: EmitTrailerOutcomesInput): Promise<EmitTrailerOutcomesResult> {
  if (!input.body || typeof input.body !== "object") return EMPTY;
  const body = input.body as Any;
  const commits = Array.isArray(body.commits) ? body.commits : [];
  if (commits.length === 0) return EMPTY;

  let trailersFound = 0;
  let outcomesInserted = 0;
  for (const c of commits) {
    if (!c || typeof c !== "object") continue;
    const commit = c as Any;
    const message = typeof commit.message === "string" ? commit.message : "";
    const sha = strOrNull(commit.id) ?? strOrNull(commit.sha);
    if (sha === null) continue;
    const trailer = parseAiAssistedTrailer(message);
    if (!trailer) continue;
    trailersFound++;
    const inserted = await writeOutcome({
      orgId: input.orgId,
      commitSha: sha,
      sessionId: trailer.sessionId,
      prNumber: null,
      kind: "commit_landed",
      trailerSource: "push",
      requestId: input.requestId,
      messageForLog: message,
      outcomesStore: input.outcomesStore,
    });
    if (inserted) outcomesInserted++;
  }

  return {
    commitsInspected: commits.length,
    trailersFound,
    outcomesInserted,
  };
}

async function handlePullRequest(
  input: EmitTrailerOutcomesInput,
): Promise<EmitTrailerOutcomesResult> {
  if (!input.body || typeof input.body !== "object") return EMPTY;
  const body = input.body as Any;
  const action = strOrNull(body.action);
  if (action !== "closed") return EMPTY;
  const pr = body.pull_request as Any | undefined;
  if (!pr || typeof pr !== "object") return EMPTY;
  if (pr.merged !== true) return EMPTY;
  const mergeCommitSha = strOrNull(pr.merge_commit_sha);
  if (mergeCommitSha === null) return EMPTY;
  // GitHub's pull_request webhook does NOT ship the merge commit's full
  // message body — only `title` + `body` on the PR. A squash-merged PR puts
  // the original trailer-carrying commit's message into the PR body, so we
  // check PR body FIRST, then fall back to the title. Each candidate is
  // parsed independently so that prose poisoning one field doesn't block
  // the other.
  const prTitle = strOrNull(pr.title) ?? "";
  const prBody = strOrNull(pr.body) ?? "";
  const candidates = [prBody, prTitle];
  let trailer = null;
  for (const c of candidates) {
    if (!c) continue;
    trailer = parseAiAssistedTrailer(c);
    if (trailer !== null) break;
  }
  if (!trailer) {
    return { commitsInspected: 1, trailersFound: 0, outcomesInserted: 0 };
  }
  const inserted = await writeOutcome({
    orgId: input.orgId,
    commitSha: mergeCommitSha,
    sessionId: trailer.sessionId,
    prNumber: numOrNull(pr.number),
    kind: "pr_merged",
    trailerSource: "pull_request",
    requestId: input.requestId,
    messageForLog: `${prTitle}\n\n${prBody}`,
    outcomesStore: input.outcomesStore,
  });
  return {
    commitsInspected: 1,
    trailersFound: 1,
    outcomesInserted: inserted ? 1 : 0,
  };
}

async function writeOutcome(opts: {
  orgId: string;
  commitSha: string;
  sessionId: string;
  prNumber: number | null;
  kind: "pr_merged" | "commit_landed";
  trailerSource: TrailerSource;
  requestId: string | undefined;
  messageForLog: string;
  outcomesStore: OutcomesStore;
}): Promise<boolean> {
  const { inserted } = await opts.outcomesStore.upsert({
    org_id: opts.orgId,
    engineer_id: null,
    kind: opts.kind,
    pr_number: opts.prNumber,
    commit_sha: opts.commitSha,
    session_id: opts.sessionId,
    ai_assisted: true,
    trailer_source: opts.trailerSource,
  });
  logger.info(
    {
      request_id: opts.requestId,
      org_id: opts.orgId,
      commit_sha: opts.commitSha,
      session_id: opts.sessionId,
      pr_number: opts.prNumber,
      trailer_source: opts.trailerSource,
      inserted,
      // NEVER log the raw message — it may contain prompt-adjacent text.
      message: sanitizeCommitMessageForLog(opts.messageForLog),
    },
    "outcome trailer recorded",
  );
  return inserted;
}
