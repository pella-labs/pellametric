import { describe, expect, test } from "bun:test";
import { createInMemoryGitEventsStore, type GitEventRow } from "./gitEventsStore";

function prRow(overrides: Partial<GitEventRow> = {}): GitEventRow {
  return {
    source: "github",
    event_kind: "pull_request.opened",
    pr_node_id: "PR_kwDO_1",
    repo_id: "R_kwDO_1",
    pr_number: 1,
    commit_sha: null,
    merged_at: null,
    payload: {},
    ...overrides,
  };
}

describe("gitEventsStore (in-memory)", () => {
  test("two different pr_node_ids both insert (count=2)", async () => {
    const s = createInMemoryGitEventsStore();
    const a = await s.upsert(prRow({ pr_node_id: "PR_A" }), "org1");
    const b = await s.upsert(prRow({ pr_node_id: "PR_B" }), "org1");
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(true);
    expect(await s.count("org1")).toBe(2);
  });

  test("same pr_node_id twice → second inserted=false, count stays 1, latest payload retained", async () => {
    const s = createInMemoryGitEventsStore();
    const first = await s.upsert(prRow({ pr_node_id: "PR_X", payload: { a: 1 } }), "org1");
    const second = await s.upsert(prRow({ pr_node_id: "PR_X", payload: { a: 2 } }), "org1");
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(await s.count("org1")).toBe(1);
    const stored = await s.findByPrNode("org1", "PR_X");
    expect((stored?.payload as { a: number }).a).toBe(2);
  });

  test("push events (pr_node_id=null) always insert (count=2 after two pushes)", async () => {
    const s = createInMemoryGitEventsStore();
    const a = await s.upsert(
      prRow({ pr_node_id: null, event_kind: "push", commit_sha: "aaa" }),
      "org1",
    );
    const b = await s.upsert(
      prRow({ pr_node_id: null, event_kind: "push", commit_sha: "bbb" }),
      "org1",
    );
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(true);
    expect(await s.count("org1")).toBe(2);
  });

  test("different orgs with same pr_node_id both insert", async () => {
    const s = createInMemoryGitEventsStore();
    const a = await s.upsert(prRow({ pr_node_id: "PR_SHARED" }), "org1");
    const b = await s.upsert(prRow({ pr_node_id: "PR_SHARED" }), "org2");
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(true);
    expect(await s.count("org1")).toBe(1);
    expect(await s.count("org2")).toBe(1);
  });
});
