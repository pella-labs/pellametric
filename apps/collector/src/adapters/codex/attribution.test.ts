// Acceptance tests for the Codex adapter's attribution fields.
//
// Ensures the Codex adapter produces at least one Event with:
//   - source === "codex" (so CH row lands under source='codex')
//   - gen_ai_request_model populated with the real Codex model (NOT homogenized
//     to claude-opus-4-7); pulled from turn_context when token_count omits it
//   - dev_metrics.tool_name populated from the actual command (e.g. "bun",
//     "git") rather than the hard-coded literal "shell"
//   - raw_attrs.branch populated from the session's cwd/.git/HEAD (ingest
//     copies this into the CH column `branch`)
//
// Runs on a dedicated fixture `rollout-turn-context.jsonl` modelled on real
// Codex CLI output (type="event_msg" wrappers, turn_context payload).

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveBranch } from "./index";
import { normalizeSession } from "./normalize";
import { parseSessionFile } from "./parsers/parseSessionFile";

const FIX = join(import.meta.dir, "fixtures", "rollout-turn-context.jsonl");

const IDENTITY = {
  tenantId: "org_acme",
  engineerId: "eng_test",
  deviceId: "dev_test",
  tier: "B" as const,
};

test("normalize emits ≥1 event with source='codex'", async () => {
  const parsed = await parseSessionFile(FIX);
  const events = normalizeSession(parsed, IDENTITY, "0.1.0");
  expect(events.length).toBeGreaterThanOrEqual(1);
  const codexSourced = events.filter((e) => e.source === "codex");
  expect(codexSourced.length).toBe(events.length);
});

test("gen_ai.request.model carries the real Codex model from turn_context (not homogenized)", async () => {
  const parsed = await parseSessionFile(FIX);
  expect(parsed.activeModel).toBe("gpt-5.3-codex");

  const events = normalizeSession(parsed, IDENTITY, "0.1.0");
  const llmResp = events.find((e) => e.dev_metrics.event_kind === "llm_response");
  expect(llmResp).toBeDefined();
  expect(llmResp?.gen_ai?.request?.model).toBe("gpt-5.3-codex");
  expect(llmResp?.gen_ai?.response?.model).toBe("gpt-5.3-codex");
  // Negative assertion: never homogenized to Claude.
  expect(llmResp?.gen_ai?.request?.model).not.toMatch(/claude/i);

  const llmReq = events.find((e) => e.dev_metrics.event_kind === "llm_request");
  // user_message in this fixture has no model → must fall back to turn_context.
  expect(llmReq?.gen_ai?.request?.model).toBe("gpt-5.3-codex");
});

test("tool_name is derived from the actual command (toolBreakdown keys), not the literal 'shell'", async () => {
  const parsed = await parseSessionFile(FIX);
  // toolBreakdown mined per command basename.
  expect(parsed.toolBreakdown.get("bun")).toBe(1);
  expect(parsed.toolBreakdown.get("git")).toBe(1);

  const events = normalizeSession(parsed, IDENTITY, "0.1.0");
  const execStarts = events.filter((e) => e.dev_metrics.event_kind === "exec_command_start");
  const execEnds = events.filter((e) => e.dev_metrics.event_kind === "exec_command_end");

  const starts = execStarts.map((e) => e.dev_metrics.tool_name);
  expect(starts).toContain("bun");
  expect(starts).toContain("git");
  // Negative: no exec event should ever carry the hard-coded "shell" placeholder
  // in this fixture — every start has a real command.
  for (const n of starts) expect(n).not.toBe("shell");

  // exec_command_end inherits tool_name from the prior start in the same turn.
  const endNames = execEnds.map((e) => e.dev_metrics.tool_name);
  expect(endNames).toContain("bun");
  expect(endNames).toContain("git");

  // Non-empty guarantee across all exec rows.
  for (const e of [...execStarts, ...execEnds]) {
    expect(e.dev_metrics.tool_name).toBeTruthy();
    expect((e.dev_metrics.tool_name ?? "").length).toBeGreaterThan(0);
  }
});

test("branch is populated from session cwd's .git/HEAD via raw_attrs.branch", async () => {
  // Synthesize a fake cwd with a .git/HEAD so resolveBranch can read it.
  const repo = mkdtempSync(join(tmpdir(), "codex-branch-test-"));
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/feature/scoring\n");
  try {
    const branch = await resolveBranch(undefined, repo);
    expect(branch).toBe("feature/scoring");

    const parsed = await parseSessionFile(FIX);
    const events = normalizeSession(parsed, IDENTITY, "0.1.0", branch ? { branch } : {});
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.raw_attrs?.branch).toBe("feature/scoring");
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("acceptance: ≥1 event with source='codex', real model, non-empty tool_name, non-empty branch", async () => {
  const repo = mkdtempSync(join(tmpdir(), "codex-accept-"));
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  try {
    const branch = await resolveBranch(undefined, repo);
    const parsed = await parseSessionFile(FIX);
    const events = normalizeSession(parsed, IDENTITY, "0.1.0", branch ? { branch } : {});

    // Batch-level acceptance: across the emitted events we must see all four
    // attribution signals populated. Model lives on llm_request/llm_response
    // events; tool_name lives on exec_command_* events — different event
    // kinds by design, both tagged with source='codex' and branch.
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const e of events) expect(e.source).toBe("codex");

    const hasRealModel = events.some((e) => e.gen_ai?.request?.model === "gpt-5.3-codex");
    const hasRealToolName = events.some(
      (e) => e.dev_metrics.event_kind === "exec_command_start" && e.dev_metrics.tool_name === "bun",
    );
    const allHaveBranch = events.every((e) => e.raw_attrs?.branch === "main");

    expect(hasRealModel).toBe(true);
    expect(hasRealToolName).toBe(true);
    expect(allHaveBranch).toBe(true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
