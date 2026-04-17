// GitHub webhook payload → GitEventRow (Sprint-1 Phase 6).
// Supported event types per PRD §Phase 6: pull_request, pull_request_review,
// push, workflow_run, check_suite. Unsupported → null (router maps to
// ignored=true, 200). Badly-shaped payload (no repository.node_id) throws
// `Error("github:bad-payload")` → router maps to 400.

import type { GitEventRow } from "./gitEventsStore";

type Any = Record<string, unknown>;

function repoNodeId(body: Any): string {
  const repo = body.repository as Any | undefined;
  const nodeId = repo?.node_id;
  if (typeof nodeId !== "string" || nodeId.length === 0) {
    throw new Error("github:bad-payload");
  }
  return nodeId;
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function parseGitHubWebhook(event: string, body: unknown): GitEventRow | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Any;

  if (event === "pull_request") {
    const repo_id = repoNodeId(b);
    const pr = b.pull_request as Any | undefined;
    const action = strOrUndef(b.action) ?? "unknown";
    return {
      source: "github",
      event_kind: `pull_request.${action}`,
      pr_node_id: asString(pr?.node_id),
      repo_id,
      ...(typeof pr?.number === "number" ? { pr_number: pr.number as number } : {}),
      commit_sha: asString(pr?.merge_commit_sha),
      merged_at: asString(pr?.merged_at),
      payload: body,
    };
  }

  if (event === "pull_request_review") {
    const repo_id = repoNodeId(b);
    const pr = b.pull_request as Any | undefined;
    const action = strOrUndef(b.action) ?? "unknown";
    return {
      source: "github",
      event_kind: `pull_request_review.${action}`,
      pr_node_id: asString(pr?.node_id),
      repo_id,
      ...(typeof pr?.number === "number" ? { pr_number: pr.number as number } : {}),
      commit_sha: null,
      payload: body,
    };
  }

  if (event === "push") {
    const repo_id = repoNodeId(b);
    return {
      source: "github",
      event_kind: "push",
      pr_node_id: null,
      repo_id,
      commit_sha: asString(b.after),
      payload: body,
    };
  }

  if (event === "workflow_run") {
    const repo_id = repoNodeId(b);
    const action = strOrUndef(b.action) ?? "unknown";
    const run = b.workflow_run as Any | undefined;
    return {
      source: "github",
      event_kind: `workflow_run.${action}`,
      pr_node_id: null,
      repo_id,
      commit_sha: asString(run?.head_sha),
      payload: body,
    };
  }

  if (event === "check_suite") {
    const repo_id = repoNodeId(b);
    const action = strOrUndef(b.action) ?? "unknown";
    const suite = b.check_suite as Any | undefined;
    return {
      source: "github",
      event_kind: `check_suite.${action}`,
      pr_node_id: null,
      repo_id,
      commit_sha: asString(suite?.head_sha),
      payload: body,
    };
  }

  return null;
}
