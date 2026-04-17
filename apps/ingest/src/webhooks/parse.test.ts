import { describe, expect, test } from "bun:test";
import { parseBitbucketWebhook } from "./bitbucket";
import { parseGitHubWebhook } from "./github";
import { parseGitLabWebhook } from "./gitlab";

describe("parseGitHubWebhook", () => {
  test("pull_request.opened → pr_node_id + number", () => {
    const row = parseGitHubWebhook("pull_request", {
      action: "opened",
      pull_request: { node_id: "PR_kwDO_1", number: 42, merge_commit_sha: null, merged_at: null },
      repository: { node_id: "R_kwDO_1" },
    });
    expect(row).not.toBeNull();
    expect(row?.event_kind).toBe("pull_request.opened");
    expect(row?.pr_node_id).toBe("PR_kwDO_1");
    expect(row?.pr_number).toBe(42);
    expect(row?.repo_id).toBe("R_kwDO_1");
  });

  test("pull_request.closed with merge_commit_sha populated", () => {
    const row = parseGitHubWebhook("pull_request", {
      action: "closed",
      pull_request: {
        node_id: "PR_1",
        number: 1,
        merge_commit_sha: "abc123",
        merged_at: "2026-04-16T00:00:00Z",
      },
      repository: { node_id: "R_1" },
    });
    expect(row?.event_kind).toBe("pull_request.closed");
    expect(row?.commit_sha).toBe("abc123");
    expect(row?.merged_at).toBe("2026-04-16T00:00:00Z");
  });

  test("push → pr_node_id null, commit_sha=after", () => {
    const row = parseGitHubWebhook("push", {
      after: "deadbeef",
      repository: { node_id: "R_1" },
    });
    expect(row?.event_kind).toBe("push");
    expect(row?.pr_node_id).toBeNull();
    expect(row?.commit_sha).toBe("deadbeef");
  });

  test("workflow_run → pr_node_id null, commit_sha=workflow_run.head_sha", () => {
    const row = parseGitHubWebhook("workflow_run", {
      action: "completed",
      workflow_run: { head_sha: "sha-xyz" },
      repository: { node_id: "R_1" },
    });
    expect(row?.event_kind).toBe("workflow_run.completed");
    expect(row?.pr_node_id).toBeNull();
    expect(row?.commit_sha).toBe("sha-xyz");
  });

  test("unknown event type → null", () => {
    const row = parseGitHubWebhook("ping", { zen: "hi", repository: { node_id: "R_1" } });
    expect(row).toBeNull();
  });

  test("missing repository.node_id → throws github:bad-payload", () => {
    expect(() =>
      parseGitHubWebhook("pull_request", { action: "opened", pull_request: { node_id: "x" } }),
    ).toThrow("github:bad-payload");
  });
});

describe("parseGitLabWebhook", () => {
  test("merge_request → pr_node_id from object_attributes.id", () => {
    const row = parseGitLabWebhook("Merge Request Hook", {
      object_kind: "merge_request",
      object_attributes: { id: 99, iid: 7, action: "open" },
      project: { id: 100 },
    });
    expect(row?.event_kind).toBe("merge_request.open");
    expect(row?.pr_node_id).toBe("99");
    expect(row?.repo_id).toBe("100");
    expect(row?.pr_number).toBe(7);
  });

  test("push → pr_node_id null", () => {
    const row = parseGitLabWebhook("Push Hook", {
      object_kind: "push",
      after: "sha-abc",
      project: { id: 100 },
    });
    expect(row?.event_kind).toBe("push");
    expect(row?.pr_node_id).toBeNull();
    expect(row?.commit_sha).toBe("sha-abc");
  });

  test("unknown object_kind → null", () => {
    const row = parseGitLabWebhook("X", { object_kind: "wiki_page", project: { id: 1 } });
    expect(row).toBeNull();
  });
});

describe("parseBitbucketWebhook", () => {
  test("pullrequest:created → pr_node_id from pullrequest.id", () => {
    const row = parseBitbucketWebhook("pullrequest:created", {
      pullrequest: { id: 12 },
      repository: { uuid: "{aaa-bbb}" },
    });
    expect(row?.event_kind).toBe("pullrequest.created");
    expect(row?.pr_node_id).toBe("12");
    expect(row?.repo_id).toBe("{aaa-bbb}");
  });

  test("repo:push → pr_node_id null", () => {
    const row = parseBitbucketWebhook("repo:push", {
      push: { changes: [{ new: { target: { hash: "sha-1" } } }] },
      repository: { uuid: "{aaa}" },
    });
    expect(row?.event_kind).toBe("push");
    expect(row?.pr_node_id).toBeNull();
    expect(row?.commit_sha).toBe("sha-1");
  });

  test("unknown event → null", () => {
    const row = parseBitbucketWebhook("issue:created", { repository: { uuid: "{u}" } });
    expect(row).toBeNull();
  });
});
