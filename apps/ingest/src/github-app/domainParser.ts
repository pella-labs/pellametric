// GitHub webhook → structured domain row(s) parser (PRD §7.1, §9.2–§9.5).
//
// Called by the worker consumer, not the ingest HTTP handler. The HTTP path
// only needs a parser at the level of "does this event-kind make sense?" —
// the full UPSERT-shape parsing happens in the worker so HTTP handlers return
// in <500ms.
//
// Exported shapes are deterministic over the input JSON. No side effects.
//
// --- Forbidden-field discipline (D57) -------------------------------------
// The evidence field never carries raw human strings. PR titles, commit
// messages, CODEOWNERS login names, and all branch labels are hashed with
// SHA-256 (truncated to 16 bytes) before being surfaced. The recompute
// message producer (`toRecomputeMessage`) emits ONLY structural counts +
// hashes; the raw_payload bytes travel separately inside the Redpanda
// message for the worker's audit needs — the worker never serializes those
// bytes into session_repo_links.evidence.
// --------------------------------------------------------------------------

import { createHash } from "node:crypto";

export type DomainParseResult =
  | { kind: "pull_request_upsert"; row: PullRequestRow; gitEventExtension: GitEventExtension }
  | { kind: "push"; gitEventExtension: GitEventExtension; forced: boolean; branch: string }
  | { kind: "check_suite_upsert"; row: CheckSuiteRow }
  | { kind: "deployment_upsert"; row: DeploymentRow }
  | { kind: "deployment_status_upsert"; row: DeploymentRow }
  | {
      kind: "installation_state_change";
      installation_id: bigint;
      next_status: "suspended" | "active" | "revoked";
      reason: "suspend" | "unsuspend" | "deleted";
    }
  | {
      kind: "repository_rename_or_transfer";
      provider_repo_id: string;
      reason: "rename" | "transfer";
      new_name?: string;
      new_owner_login?: string;
    }
  | { kind: "ignored"; event: string; action?: string };

export interface PullRequestRow {
  provider_repo_id: string;
  pr_number: number;
  pr_node_id: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  /** sha256(title) hex. */
  title_hash: string;
  base_ref: string;
  head_ref: string;
  head_sha: string;
  merge_commit_sha: string | null;
  /** sha256(login) hex — stable placeholder until G1-linker wires tenant-salted HMAC. */
  author_login_hash: string;
  author_association: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  commits_count: number;
  opened_at: string;
  closed_at: string | null;
  merged_at: string | null;
  /** Fork flag (not a column; stored in recompute evidence as "from_fork":true). */
  from_fork: boolean;
  /** Indicator that the PR body contains "closes #N" (Phase-2 feature — carried for observability). */
  has_closes_keyword: boolean;
}

export interface CheckSuiteRow {
  provider_repo_id: string;
  head_sha: string;
  suite_id: bigint;
  status: "queued" | "in_progress" | "completed";
  conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "action_required"
    | "stale"
    | null;
  runs_count: number;
  failed_runs_count: number;
  started_at: string | null;
  completed_at: string | null;
}

export interface DeploymentRow {
  provider_repo_id: string;
  deployment_id: bigint;
  environment: string;
  sha: string;
  ref: string;
  /** One of the GitHub deployment_status.state values. `created` (= deployment.created event) maps to `pending`. */
  status: "pending" | "queued" | "in_progress" | "success" | "failure" | "error" | "inactive";
  first_success_at: string | null;
}

export interface GitEventExtension {
  /** Resolved per-tenant after worker reads the delivery's tenant_id. */
  provider_repo_id: string | null;
  /** e.g. "refs/heads/main" → "main"; null for non-push events. */
  branch: string | null;
  commit_sha: string | null;
  pr_number: number | null;
  author_association: string | null;
}

function sha256hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numOr0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function branchFromRef(ref: string | null): string | null {
  if (!ref) return null;
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

function boolOrFalse(v: unknown): boolean {
  return v === true;
}

export function parseDomain(event: string, body: unknown): DomainParseResult {
  if (!body || typeof body !== "object") return { kind: "ignored", event };
  const b = body as Record<string, unknown>;
  const action = strOrNull(b.action) ?? undefined;

  if (event === "pull_request") {
    return parsePullRequest(b, action);
  }
  if (event === "push") {
    return parsePush(b);
  }
  if (event === "check_suite") {
    return parseCheckSuite(b);
  }
  if (event === "installation") {
    return parseInstallationLifecycle(b, action);
  }
  if (event === "repository") {
    return parseRepositoryLifecycle(b, action);
  }
  if (event === "deployment") {
    return parseDeployment(b);
  }
  if (event === "deployment_status") {
    return parseDeploymentStatus(b);
  }
  return action !== undefined ? { kind: "ignored", event, action } : { kind: "ignored", event };
}

function parseDeployment(b: Record<string, unknown>): DomainParseResult {
  const repo = b.repository as Record<string, unknown> | undefined;
  const dep = b.deployment as Record<string, unknown> | undefined;
  if (!repo || !dep || repo.id === undefined || dep.id === undefined) {
    return { kind: "ignored", event: "deployment" };
  }
  const row: DeploymentRow = {
    provider_repo_id: String(repo.id),
    deployment_id: BigInt(String(dep.id)),
    environment: strOrNull(dep.environment) ?? strOrNull(dep.original_environment) ?? "",
    sha: strOrNull(dep.sha) ?? "",
    ref: strOrNull(dep.ref) ?? "",
    // `deployment` event itself represents creation — a not-yet-statused
    // deployment → treat as `pending` until a deployment_status arrives.
    status: "pending",
    first_success_at: null,
  };
  return { kind: "deployment_upsert", row };
}

function parseDeploymentStatus(b: Record<string, unknown>): DomainParseResult {
  const repo = b.repository as Record<string, unknown> | undefined;
  const dep = b.deployment as Record<string, unknown> | undefined;
  const ds = b.deployment_status as Record<string, unknown> | undefined;
  if (!repo || !dep || !ds || repo.id === undefined || dep.id === undefined) {
    return { kind: "ignored", event: "deployment_status" };
  }
  const state = strOrNull(ds.state);
  const allowedStates = new Set([
    "pending",
    "queued",
    "in_progress",
    "success",
    "failure",
    "error",
    "inactive",
  ]);
  if (!state || !allowedStates.has(state)) {
    return { kind: "ignored", event: "deployment_status" };
  }
  const status = state as DeploymentRow["status"];
  const row: DeploymentRow = {
    provider_repo_id: String(repo.id),
    deployment_id: BigInt(String(dep.id)),
    environment:
      strOrNull(ds.environment) ??
      strOrNull(dep.environment) ??
      strOrNull(dep.original_environment) ??
      "",
    sha: strOrNull(dep.sha) ?? "",
    ref: strOrNull(dep.ref) ?? "",
    status,
    // first_success_at: persist when state transitions to success; the
    // consumer's UPSERT picks the earliest success across redeliveries.
    first_success_at:
      status === "success" ? (strOrNull(ds.created_at) ?? strOrNull(ds.updated_at)) : null,
  };
  return { kind: "deployment_status_upsert", row };
}

function parsePullRequest(
  b: Record<string, unknown>,
  action: string | undefined,
): DomainParseResult {
  if (!action) return { kind: "ignored", event: "pull_request" };
  // We care about: opened, synchronize, closed, edited, reopened. Others skip.
  const SUPPORTED = new Set(["opened", "synchronize", "closed", "edited", "reopened"]);
  if (!SUPPORTED.has(action)) return { kind: "ignored", event: "pull_request", action };

  const pr = b.pull_request as Record<string, unknown> | undefined;
  const repo = b.repository as Record<string, unknown> | undefined;
  if (!pr || !repo) return { kind: "ignored", event: "pull_request", action };

  const provider_repo_id = strOrNull(repo.id ? String(repo.id) : null);
  if (!provider_repo_id) return { kind: "ignored", event: "pull_request", action };

  const pr_node_id = strOrNull(pr.node_id);
  const pr_number = typeof pr.number === "number" ? pr.number : null;
  if (!pr_node_id || pr_number === null) {
    return action !== undefined
      ? { kind: "ignored", event: "pull_request", action }
      : { kind: "ignored", event: "pull_request" };
  }

  const merged_at = strOrNull(pr.merged_at);
  const closed_at = strOrNull(pr.closed_at);
  const merge_commit_sha = strOrNull(pr.merge_commit_sha);
  // State derivation: merged wins over closed wins over draft/open.
  let state: PullRequestRow["state"];
  if (merged_at) state = "merged";
  else if (action === "closed" || closed_at) state = "closed";
  else state = "open";

  const head = pr.head as Record<string, unknown> | undefined;
  const base = pr.base as Record<string, unknown> | undefined;
  const user = pr.user as Record<string, unknown> | undefined;
  const title = strOrNull(pr.title) ?? "";
  const userLogin = strOrNull(user?.login) ?? "";

  // Fork detection — head.repo.id differs from repository.id.
  const headRepoId = head?.repo ? (head.repo as Record<string, unknown>).id : undefined;
  const from_fork =
    headRepoId !== undefined && repo.id !== undefined && String(headRepoId) !== String(repo.id);

  const body = strOrNull(pr.body) ?? "";
  const has_closes_keyword = /\bcloses\s*#\d+\b/i.test(body);

  const row: PullRequestRow = {
    provider_repo_id,
    pr_number,
    pr_node_id,
    state,
    draft: boolOrFalse(pr.draft),
    title_hash: sha256hex(title),
    base_ref: strOrNull((base as Record<string, unknown> | undefined)?.ref) ?? "",
    head_ref: strOrNull((head as Record<string, unknown> | undefined)?.ref) ?? "",
    head_sha: strOrNull((head as Record<string, unknown> | undefined)?.sha) ?? "",
    merge_commit_sha,
    author_login_hash: sha256hex(userLogin),
    author_association: strOrNull(pr.author_association),
    additions: numOr0(pr.additions),
    deletions: numOr0(pr.deletions),
    changed_files: numOr0(pr.changed_files),
    commits_count: numOr0(pr.commits),
    opened_at: strOrNull(pr.created_at) ?? "",
    closed_at,
    merged_at,
    from_fork,
    has_closes_keyword,
  };

  const ext: GitEventExtension = {
    provider_repo_id,
    branch: strOrNull((head as Record<string, unknown> | undefined)?.ref),
    commit_sha:
      state === "merged"
        ? merge_commit_sha
        : strOrNull((head as Record<string, unknown> | undefined)?.sha),
    pr_number,
    author_association: strOrNull(pr.author_association),
  };

  return { kind: "pull_request_upsert", row, gitEventExtension: ext };
}

function parsePush(b: Record<string, unknown>): DomainParseResult {
  const repo = b.repository as Record<string, unknown> | undefined;
  if (!repo || repo.id === undefined) return { kind: "ignored", event: "push" };
  const provider_repo_id = String(repo.id);
  const ref = strOrNull(b.ref) ?? "";
  const branch = branchFromRef(ref) ?? "";
  const forced = b.forced === true;
  const commit_sha = strOrNull(b.after);
  const ext: GitEventExtension = {
    provider_repo_id,
    branch,
    commit_sha,
    pr_number: null,
    author_association: null,
  };
  return { kind: "push", branch, forced, gitEventExtension: ext };
}

function parseCheckSuite(b: Record<string, unknown>): DomainParseResult {
  const repo = b.repository as Record<string, unknown> | undefined;
  const cs = b.check_suite as Record<string, unknown> | undefined;
  if (!repo || !cs || repo.id === undefined || cs.id === undefined) {
    return { kind: "ignored", event: "check_suite" };
  }
  const status = strOrNull(cs.status);
  if (status !== "queued" && status !== "in_progress" && status !== "completed") {
    return { kind: "ignored", event: "check_suite" };
  }
  const conclusion = strOrNull(cs.conclusion);
  const runs = cs.latest_check_runs_count;
  const row: CheckSuiteRow = {
    provider_repo_id: String(repo.id),
    head_sha: strOrNull(cs.head_sha) ?? "",
    suite_id: BigInt(String(cs.id)),
    status,
    conclusion:
      conclusion === "success" ||
      conclusion === "failure" ||
      conclusion === "neutral" ||
      conclusion === "cancelled" ||
      conclusion === "skipped" ||
      conclusion === "timed_out" ||
      conclusion === "action_required" ||
      conclusion === "stale"
        ? conclusion
        : null,
    runs_count: numOr0(runs),
    failed_runs_count: conclusion === "failure" ? 1 : 0,
    started_at: strOrNull(cs.created_at),
    completed_at: conclusion ? (strOrNull(cs.updated_at) ?? null) : null,
  };
  return { kind: "check_suite_upsert", row };
}

function parseInstallationLifecycle(
  b: Record<string, unknown>,
  action: string | undefined,
): DomainParseResult {
  if (action !== "suspend" && action !== "unsuspend" && action !== "deleted") {
    return action !== undefined
      ? { kind: "ignored", event: "installation", action }
      : { kind: "ignored", event: "installation" };
  }
  const inst = b.installation as Record<string, unknown> | undefined;
  if (!inst || inst.id === undefined) return { kind: "ignored", event: "installation", action };
  // action is narrowed to 'suspend' | 'unsuspend' | 'deleted' from the guard above.
  const installation_id = BigInt(String(inst.id));
  const next_status: "suspended" | "active" | "revoked" =
    action === "suspend" ? "suspended" : action === "unsuspend" ? "active" : "revoked";
  return {
    kind: "installation_state_change",
    installation_id,
    next_status,
    reason: action,
  };
}

function parseRepositoryLifecycle(
  b: Record<string, unknown>,
  action: string | undefined,
): DomainParseResult {
  if (action !== "renamed" && action !== "transferred") {
    return action !== undefined
      ? { kind: "ignored", event: "repository", action }
      : { kind: "ignored", event: "repository" };
  }
  const repo = b.repository as Record<string, unknown> | undefined;
  if (!repo || repo.id === undefined) {
    return { kind: "ignored", event: "repository", action };
  }
  const provider_repo_id = String(repo.id);
  const reason: "rename" | "transfer" = action === "renamed" ? "rename" : "transfer";
  const newName = action === "renamed" ? (strOrNull(repo.name) ?? undefined) : undefined;
  const owner = repo.owner as Record<string, unknown> | undefined;
  const newOwner = action === "transferred" ? (strOrNull(owner?.login) ?? undefined) : undefined;
  return {
    kind: "repository_rename_or_transfer",
    provider_repo_id,
    reason,
    ...(newName !== undefined ? { new_name: newName } : {}),
    ...(newOwner !== undefined ? { new_owner_login: newOwner } : {}),
  };
}
