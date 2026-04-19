// Pure-parser contract tests for the 12 G1 fixtures (PRD §13 Phase G1 tests).
// No DB, no network — just JSON fixtures → DomainParseResult assertions.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDomain } from "./domainParser";

const FIXTURES_ROOT = resolve(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "packages",
  "fixtures",
  "github",
);

function body(event: string, scenario: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES_ROOT, event, `${scenario}.json`), "utf8"));
}

describe("domainParser — 12 G1 fixtures", () => {
  // ---- pull_request --------------------------------------------------------

  test("pull_request.opened (G0) → pull_request_upsert, state=open, from_fork=false", () => {
    const r = parseDomain("pull_request", body("pull_request", "opened"));
    expect(r.kind).toBe("pull_request_upsert");
    if (r.kind !== "pull_request_upsert") throw new Error("unreachable");
    expect(r.row.state).toBe("open");
    expect(r.row.from_fork).toBe(false);
    expect(r.row.pr_number).toBe(7);
    expect(r.row.provider_repo_id).toBe("987654321");
    expect(r.row.author_association).toBe("MEMBER");
    expect(r.gitEventExtension.branch).toBe("feature/fixture-branch");
    expect(r.gitEventExtension.pr_number).toBe(7);
  });

  test("pull_request.synchronize (G0) → pull_request_upsert, state=open", () => {
    const r = parseDomain("pull_request", body("pull_request", "synchronize"));
    expect(r.kind).toBe("pull_request_upsert");
    if (r.kind !== "pull_request_upsert") throw new Error("unreachable");
    expect(r.row.state).toBe("open");
  });

  test("pull_request.closed-merged-squash (G0) → state=merged, merge_commit_sha set", () => {
    const r = parseDomain("pull_request", body("pull_request", "closed-merged-squash"));
    expect(r.kind).toBe("pull_request_upsert");
    if (r.kind !== "pull_request_upsert") throw new Error("unreachable");
    expect(r.row.state).toBe("merged");
    expect(r.row.merge_commit_sha).toBe("0000000000000000000000000000000000000003");
    expect(r.gitEventExtension.commit_sha).toBe("0000000000000000000000000000000000000003");
  });

  test("pull_request.closed-merged-rebase → state=merged", () => {
    const r = parseDomain("pull_request", body("pull_request", "closed-merged-rebase"));
    expect(r.kind).toBe("pull_request_upsert");
    if (r.kind !== "pull_request_upsert") throw new Error("unreachable");
    expect(r.row.state).toBe("merged");
    expect(r.row.merge_commit_sha).toBe("0000000000000000000000000000000000000008");
  });

  test("pull_request.closed-unmerged → state=closed, merge_commit_sha=null", () => {
    const r = parseDomain("pull_request", body("pull_request", "closed-unmerged"));
    expect(r.kind).toBe("pull_request_upsert");
    if (r.kind !== "pull_request_upsert") throw new Error("unreachable");
    expect(r.row.state).toBe("closed");
    expect(r.row.merge_commit_sha).toBeNull();
  });

  test("pull_request.opened-from-fork → from_fork=true, author_association=CONTRIBUTOR", () => {
    const r = parseDomain("pull_request", body("pull_request", "opened-from-fork"));
    expect(r.kind).toBe("pull_request_upsert");
    if (r.kind !== "pull_request_upsert") throw new Error("unreachable");
    expect(r.row.from_fork).toBe(true);
    expect(r.row.author_association).toBe("CONTRIBUTOR");
  });

  test("pull_request.edited-with-closes-keyword → has_closes_keyword=true", () => {
    const r = parseDomain("pull_request", body("pull_request", "edited-with-closes-keyword"));
    expect(r.kind).toBe("pull_request_upsert");
    if (r.kind !== "pull_request_upsert") throw new Error("unreachable");
    expect(r.row.has_closes_keyword).toBe(true);
  });

  // ---- push ----------------------------------------------------------------

  test("push.regular (G0) → push, branch=main, forced=false", () => {
    const r = parseDomain("push", body("push", "regular"));
    expect(r.kind).toBe("push");
    if (r.kind !== "push") throw new Error("unreachable");
    expect(r.branch).toBe("main");
    expect(r.forced).toBe(false);
    expect(r.gitEventExtension.commit_sha).toBe("0000000000000000000000000000000000000001");
  });

  test("push.forced (G0) → forced=true", () => {
    const r = parseDomain("push", body("push", "forced"));
    expect(r.kind).toBe("push");
    if (r.kind !== "push") throw new Error("unreachable");
    expect(r.forced).toBe(true);
  });

  test("push.to-default-branch → branch=main, commit_sha latest", () => {
    const r = parseDomain("push", body("push", "to-default-branch"));
    expect(r.kind).toBe("push");
    if (r.kind !== "push") throw new Error("unreachable");
    expect(r.branch).toBe("main");
    expect(r.gitEventExtension.commit_sha).toBe("0000000000000000000000000000000000000022");
  });

  test("push.to-non-default → branch=feature/fixture-branch", () => {
    const r = parseDomain("push", body("push", "to-non-default"));
    expect(r.kind).toBe("push");
    if (r.kind !== "push") throw new Error("unreachable");
    expect(r.branch).toBe("feature/fixture-branch");
  });

  // ---- check_suite ---------------------------------------------------------

  test("check_suite.completed-success (G0) → check_suite_upsert, conclusion=success", () => {
    const r = parseDomain("check_suite", body("check_suite", "completed-success"));
    expect(r.kind).toBe("check_suite_upsert");
    if (r.kind !== "check_suite_upsert") throw new Error("unreachable");
    expect(r.row.conclusion).toBe("success");
    expect(r.row.failed_runs_count).toBe(0);
  });

  test("check_suite.completed-failure → conclusion=failure, failed_runs_count=1", () => {
    const r = parseDomain("check_suite", body("check_suite", "completed-failure"));
    expect(r.kind).toBe("check_suite_upsert");
    if (r.kind !== "check_suite_upsert") throw new Error("unreachable");
    expect(r.row.conclusion).toBe("failure");
    expect(r.row.failed_runs_count).toBe(1);
  });

  // ---- installation lifecycle ---------------------------------------------

  test("installation.suspend → next_status=suspended", () => {
    const r = parseDomain("installation", body("installation", "suspend"));
    expect(r.kind).toBe("installation_state_change");
    if (r.kind !== "installation_state_change") throw new Error("unreachable");
    expect(r.next_status).toBe("suspended");
    expect(r.installation_id).toBe(42424242n);
  });

  test("installation.unsuspend → next_status=active", () => {
    const r = parseDomain("installation", body("installation", "unsuspend"));
    expect(r.kind).toBe("installation_state_change");
    if (r.kind !== "installation_state_change") throw new Error("unreachable");
    expect(r.next_status).toBe("active");
  });

  test("installation.deleted → next_status=revoked", () => {
    const r = parseDomain("installation", body("installation", "deleted"));
    expect(r.kind).toBe("installation_state_change");
    if (r.kind !== "installation_state_change") throw new Error("unreachable");
    expect(r.next_status).toBe("revoked");
  });

  // ---- installation.created (G0 fixture) — NOT a state change, ignored ---

  test("installation.created → ignored (handled elsewhere at app-install time)", () => {
    const r = parseDomain("installation", body("installation", "created"));
    expect(r.kind).toBe("ignored");
  });

  // ---- repository lifecycle -----------------------------------------------

  test("repository.renamed → repository_rename_or_transfer reason=rename", () => {
    const r = parseDomain("repository", body("repository", "renamed"));
    expect(r.kind).toBe("repository_rename_or_transfer");
    if (r.kind !== "repository_rename_or_transfer") throw new Error("unreachable");
    expect(r.reason).toBe("rename");
    expect(r.provider_repo_id).toBe("987654321");
  });

  test("repository.transferred → reason=transfer", () => {
    const r = parseDomain("repository", body("repository", "transferred"));
    expect(r.kind).toBe("repository_rename_or_transfer");
    if (r.kind !== "repository_rename_or_transfer") throw new Error("unreachable");
    expect(r.reason).toBe("transfer");
  });

  // ---- deployment / deployment_status (G3) --------------------------------

  test("deployment.created → deployment_upsert, status=pending, environment=production", () => {
    const r = parseDomain("deployment", body("deployment", "created"));
    expect(r.kind).toBe("deployment_upsert");
    if (r.kind !== "deployment_upsert") throw new Error("unreachable");
    expect(r.row.status).toBe("pending");
    expect(r.row.environment).toBe("production");
    expect(r.row.sha).toBe("0000000000000000000000000000000000000001");
    expect(r.row.provider_repo_id).toBe("987654321");
    expect(r.row.deployment_id).toBe(900001n);
  });

  test("deployment_status.success → deployment_status_upsert, status=success, first_success_at set", () => {
    const r = parseDomain("deployment_status", body("deployment_status", "success"));
    expect(r.kind).toBe("deployment_status_upsert");
    if (r.kind !== "deployment_status_upsert") throw new Error("unreachable");
    expect(r.row.status).toBe("success");
    expect(r.row.environment).toBe("production");
    expect(r.row.first_success_at).toBe("2026-04-10T12:05:00Z");
  });

  test("deployment_status.failure → status=failure, first_success_at=null", () => {
    const r = parseDomain("deployment_status", body("deployment_status", "failure"));
    expect(r.kind).toBe("deployment_status_upsert");
    if (r.kind !== "deployment_status_upsert") throw new Error("unreachable");
    expect(r.row.status).toBe("failure");
    expect(r.row.first_success_at).toBeNull();
  });

  // ---- forbidden-field discipline -----------------------------------------

  test("pull_request: title_hash is sha256 hex, raw title never present on row", () => {
    const r = parseDomain("pull_request", body("pull_request", "opened"));
    if (r.kind !== "pull_request_upsert") throw new Error("unreachable");
    expect(r.row.title_hash).toMatch(/^[0-9a-f]{64}$/);
    // Structural assertion: the row keys must not contain `title`.
    expect(Object.keys(r.row)).not.toContain("title");
    expect(Object.keys(r.row)).not.toContain("body");
  });

  test("push: ignored event shape does not carry commit_message", () => {
    const r = parseDomain("push", body("push", "regular"));
    if (r.kind !== "push") throw new Error("unreachable");
    // Our parser returns GitEventExtension which cannot carry raw strings —
    // this is a structural assertion that future additions don't sneak in.
    expect(Object.keys(r.gitEventExtension).sort()).toEqual([
      "author_association",
      "branch",
      "commit_sha",
      "pr_number",
      "provider_repo_id",
    ]);
  });
});
