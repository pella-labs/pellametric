import { describe, expect, test } from "bun:test";
import { emitTrailerOutcomes } from "./emitTrailerOutcomes";
import { createInMemoryOutcomesStore } from "./outcomesStore";

const ORG = "org-1";
const TRAILER = "AI-Assisted: bematist-sess_abcdef0123";
const SESSION = "sess_abcdef0123";

function pushBody(
  commits: Array<{ id: string; message: string; email?: string }>,
): Record<string, unknown> {
  return {
    ref: "refs/heads/main",
    before: "0000",
    after: commits.at(-1)?.id ?? "0000",
    repository: { node_id: "R_NODE" },
    commits: commits.map((c) => ({
      id: c.id,
      sha: c.id,
      message: c.message,
      author: { email: c.email ?? "dev@example.com", name: "Dev" },
    })),
  };
}

function prClosedMergedBody(opts: {
  title: string;
  body: string;
  mergeCommitSha: string;
  prNumber: number;
}): Record<string, unknown> {
  return {
    action: "closed",
    pull_request: {
      node_id: "PR_NODE",
      number: opts.prNumber,
      title: opts.title,
      body: opts.body,
      merged: true,
      merge_commit_sha: opts.mergeCommitSha,
      merged_at: "2026-04-10T00:00:00Z",
    },
    repository: { node_id: "R_NODE" },
  };
}

describe("emitTrailerOutcomes — push", () => {
  test("push with trailer-bearing commit → 1 outcome row", async () => {
    const store = createInMemoryOutcomesStore();
    const result = await emitTrailerOutcomes({
      orgId: ORG,
      event: "push",
      body: pushBody([{ id: "sha-1", message: `fix: thing\n\nbody\n\n${TRAILER}` }]),
      outcomesStore: store,
    });
    expect(result).toEqual({
      commitsInspected: 1,
      trailersFound: 1,
      outcomesInserted: 1,
    });
    expect(await store.count(ORG)).toBe(1);
    const row = await store.findByCommit(ORG, "sha-1", SESSION);
    expect(row).not.toBeNull();
    expect(row?.kind).toBe("commit_landed");
    expect(row?.trailer_source).toBe("push");
    expect(row?.ai_assisted).toBe(true);
    expect(row?.session_id).toBe(SESSION);
  });

  test("push with no trailer → zero outcomes", async () => {
    const store = createInMemoryOutcomesStore();
    const result = await emitTrailerOutcomes({
      orgId: ORG,
      event: "push",
      body: pushBody([{ id: "sha-1", message: "fix: plain commit, no trailer" }]),
      outcomesStore: store,
    });
    expect(result.commitsInspected).toBe(1);
    expect(result.trailersFound).toBe(0);
    expect(result.outcomesInserted).toBe(0);
    expect(await store.count(ORG)).toBe(0);
  });

  test("push with mixed commits → only trailer-bearing ones emit outcomes", async () => {
    const store = createInMemoryOutcomesStore();
    const result = await emitTrailerOutcomes({
      orgId: ORG,
      event: "push",
      body: pushBody([
        { id: "sha-1", message: `a\n\n${TRAILER}` },
        { id: "sha-2", message: "b: plain" },
        { id: "sha-3", message: `c\n\nAI-Assisted: bematist-anothersession01` },
      ]),
      outcomesStore: store,
    });
    expect(result).toEqual({
      commitsInspected: 3,
      trailersFound: 2,
      outcomesInserted: 2,
    });
  });

  test("idempotent: same push body twice → no duplicate outcome row", async () => {
    const store = createInMemoryOutcomesStore();
    const body = pushBody([{ id: "sha-dup", message: `x\n\n${TRAILER}` }]);
    const r1 = await emitTrailerOutcomes({
      orgId: ORG,
      event: "push",
      body,
      outcomesStore: store,
    });
    const r2 = await emitTrailerOutcomes({
      orgId: ORG,
      event: "push",
      body,
      outcomesStore: store,
    });
    expect(r1.outcomesInserted).toBe(1);
    expect(r2.outcomesInserted).toBe(0);
    expect(await store.count(ORG)).toBe(1);
  });

  test("push with injection-shaped trailer → no outcome, no row", async () => {
    const store = createInMemoryOutcomesStore();
    const result = await emitTrailerOutcomes({
      orgId: ORG,
      event: "push",
      body: pushBody([
        {
          id: "sha-inj",
          message: "feat: x\n\nAI-Assisted: bematist-abc'; DROP TABLE outcomes;--",
        },
      ]),
      outcomesStore: store,
    });
    expect(result.trailersFound).toBe(0);
    expect(result.outcomesInserted).toBe(0);
    expect(await store.count(ORG)).toBe(0);
  });

  test("push with empty commits[] → zero outcomes", async () => {
    const store = createInMemoryOutcomesStore();
    const result = await emitTrailerOutcomes({
      orgId: ORG,
      event: "push",
      body: pushBody([]),
      outcomesStore: store,
    });
    expect(result).toEqual({
      commitsInspected: 0,
      trailersFound: 0,
      outcomesInserted: 0,
    });
  });

  test("missing commit.id → commit skipped gracefully", async () => {
    const store = createInMemoryOutcomesStore();
    const body: Record<string, unknown> = {
      commits: [{ message: `x\n\n${TRAILER}` }],
      repository: { node_id: "R" },
    };
    const result = await emitTrailerOutcomes({
      orgId: ORG,
      event: "push",
      body,
      outcomesStore: store,
    });
    expect(result.trailersFound).toBe(0);
    expect(result.outcomesInserted).toBe(0);
  });
});

describe("emitTrailerOutcomes — pull_request", () => {
  test("merged PR with trailer in body → 1 outcome row, kind=pr_merged", async () => {
    const store = createInMemoryOutcomesStore();
    const result = await emitTrailerOutcomes({
      orgId: ORG,
      event: "pull_request",
      body: prClosedMergedBody({
        title: "feat: add widget",
        body: `Description of what this PR does.\n\n${TRAILER}`,
        mergeCommitSha: "merge-sha-1",
        prNumber: 42,
      }),
      outcomesStore: store,
    });
    expect(result).toEqual({
      commitsInspected: 1,
      trailersFound: 1,
      outcomesInserted: 1,
    });
    const row = await store.findByCommit(ORG, "merge-sha-1", SESSION);
    expect(row?.kind).toBe("pr_merged");
    expect(row?.trailer_source).toBe("pull_request");
    expect(row?.pr_number).toBe(42);
  });

  test("non-merged PR close → zero outcomes", async () => {
    const store = createInMemoryOutcomesStore();
    const body = prClosedMergedBody({
      title: "x",
      body: TRAILER,
      mergeCommitSha: "merge-sha-2",
      prNumber: 2,
    });
    // Flip merged flag.
    ((body.pull_request as Record<string, unknown>).merged as boolean) = false;
    const result = await emitTrailerOutcomes({
      orgId: ORG,
      event: "pull_request",
      body,
      outcomesStore: store,
    });
    expect(result.outcomesInserted).toBe(0);
    expect(await store.count(ORG)).toBe(0);
  });

  test("opened PR (action!=closed) → zero outcomes", async () => {
    const store = createInMemoryOutcomesStore();
    const body: Record<string, unknown> = {
      action: "opened",
      pull_request: {
        number: 1,
        merged: false,
        title: TRAILER,
        body: TRAILER,
      },
      repository: { node_id: "R" },
    };
    const result = await emitTrailerOutcomes({
      orgId: ORG,
      event: "pull_request",
      body,
      outcomesStore: store,
    });
    expect(result.outcomesInserted).toBe(0);
  });

  test("merged PR without trailer → zero outcomes", async () => {
    const store = createInMemoryOutcomesStore();
    const result = await emitTrailerOutcomes({
      orgId: ORG,
      event: "pull_request",
      body: prClosedMergedBody({
        title: "feat: plain",
        body: "no trailer here, just a normal PR body.",
        mergeCommitSha: "merge-sha-3",
        prNumber: 3,
      }),
      outcomesStore: store,
    });
    expect(result.trailersFound).toBe(0);
    expect(result.outcomesInserted).toBe(0);
  });

  test("merged PR without merge_commit_sha → zero outcomes", async () => {
    const store = createInMemoryOutcomesStore();
    const body = prClosedMergedBody({
      title: "x",
      body: TRAILER,
      mergeCommitSha: "",
      prNumber: 9,
    });
    (body.pull_request as Record<string, unknown>).merge_commit_sha = null;
    const result = await emitTrailerOutcomes({
      orgId: ORG,
      event: "pull_request",
      body,
      outcomesStore: store,
    });
    expect(result.outcomesInserted).toBe(0);
  });
});

describe("emitTrailerOutcomes — unsupported events", () => {
  test("check_suite → no-op", async () => {
    const store = createInMemoryOutcomesStore();
    const result = await emitTrailerOutcomes({
      orgId: ORG,
      event: "check_suite",
      body: { action: "completed", repository: { node_id: "R" } },
      outcomesStore: store,
    });
    expect(result).toEqual({
      commitsInspected: 0,
      trailersFound: 0,
      outcomesInserted: 0,
    });
  });

  test("workflow_run → no-op", async () => {
    const store = createInMemoryOutcomesStore();
    const result = await emitTrailerOutcomes({
      orgId: ORG,
      event: "workflow_run",
      body: { action: "completed" },
      outcomesStore: store,
    });
    expect(result.outcomesInserted).toBe(0);
  });
});

describe("emitTrailerOutcomes — defensive", () => {
  test("non-object body → zero", async () => {
    const store = createInMemoryOutcomesStore();
    const result = await emitTrailerOutcomes({
      orgId: ORG,
      event: "push",
      body: null,
      outcomesStore: store,
    });
    expect(result.outcomesInserted).toBe(0);
  });

  test("body with non-array commits → zero, no throw", async () => {
    const store = createInMemoryOutcomesStore();
    const result = await emitTrailerOutcomes({
      orgId: ORG,
      event: "push",
      body: { commits: "not an array" },
      outcomesStore: store,
    });
    expect(result.outcomesInserted).toBe(0);
  });
});
