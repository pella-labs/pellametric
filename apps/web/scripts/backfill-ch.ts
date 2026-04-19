// Backfill grammata → ClickHouse `events`.
//   bun run apps/web/scripts/backfill-ch.ts

import { createHash } from "node:crypto";
import { createClient } from "@clickhouse/client";
import { buildAnalytics, mergeAll, readClaude, readCodex, readCursor } from "grammata";

const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CH_DATABASE = process.env.CLICKHOUSE_DATABASE ?? "bematist";
const ORG_ID = process.env.BEMATIST_ORG_ID ?? "502a349e-cb15-42ee-b3e9-d166b02b9e57";
const GIT_EMAIL = process.env.BEMATIST_GIT_EMAIL ?? "pathaksandesh025@gmail.com";

const ENGINEER_ID = createHash("sha256").update(GIT_EMAIL).digest("hex").slice(0, 32);
const DEVICE_ID = createHash("sha256")
  .update(`${GIT_EMAIL}|${process.platform}|${process.arch}`)
  .digest("hex")
  .slice(0, 32);

const NAMESPACE = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
function uuidv5(name: string): string {
  const h = createHash("sha1")
    .update(Buffer.concat([NAMESPACE, Buffer.from(name)]))
    .digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

function sourceCode(s: string): string {
  if (s === "claude" || s === "claude-code") return "claude-code";
  return s;
}
function fidelity(src: string): number {
  return src === "cursor" ? 2 : 1; // estimated vs full
}

async function main() {
  const [claude, codex, cursor] = await Promise.all([
    readClaude().catch(() => null),
    readCodex().catch(() => null),
    readCursor().catch(() => null),
  ]);
  const merged = mergeAll(claude, codex, cursor, null);
  const analytics = buildAnalytics(merged);
  const sessions = analytics.sessionRows;

  const rows: Record<string, unknown>[] = [];
  for (const s of sessions) {
    const src = sourceCode(s.source);
    const ts = new Date(s.date).toISOString().replace("T", " ").replace("Z", "");
    const rawAttrs = JSON.stringify({
      project: s.project || "",
      category: (s as { category?: string }).category || "",
      entrypoint: s.entrypoint || "",
      messageCount: s.messageCount || 0,
      totalTokens: s.totalTokens || 0,
      retryCount: s.retryCount || 0,
      totalEditTurns: s.totalEditTurns || 0,
      mostRetriedFile: s.mostRetriedFile,
      toolBreakdown: s.toolBreakdown || {},
      perToolCounts: s.perToolCounts || {},
      startHour: s.startHour || 0,
      prLinks: s.prLinks || [],
      name: s.name || "",
    });
    const common = {
      schema_version: 1,
      ts,
      org_id: ORG_ID,
      engineer_id: ENGINEER_ID,
      device_id: DEVICE_ID,
      source: src,
      source_version: s.version || "",
      fidelity: fidelity(src),
      cost_estimated: src === "cursor" ? 1 : 0,
      tier: 2,
      session_id: s.id,
      parent_session_id: null,
      gen_ai_system: s.provider || "",
      gen_ai_request_model: s.model || "",
      gen_ai_response_model: s.model || "",
      pricing_version: "",
      hunk_sha256: null,
      file_path_hash: null,
      edit_decision: "",
      revert_within_24h: null,
      first_try_failure: null,
      prompt_text: null,
      tool_input: null,
      tool_output: null,
      prompt_abstract: null,
      prompt_embedding: [],
      prompt_index: 0,
      redaction_count: 0,
      pr_number: null,
      commit_sha: null,
      branch: s.gitBranch || null,
      raw_attrs: rawAttrs,
    };
    rows.push({
      ...common,
      client_event_id: uuidv5(`${src}|${s.id}|0`),
      event_seq: 0,
      input_tokens: s.inputTokens || 0,
      output_tokens: s.outputTokens || 0,
      cache_read_input_tokens: s.cacheReadTokens || 0,
      cache_creation_input_tokens: s.cacheCreateTokens || 0,
      event_kind: "llm_request",
      cost_usd: s.cost || 0,
      duration_ms: s.durationMs || 0,
      tool_name: "",
      tool_status: "",
    });
    const total = Math.max(0, s.totalEditTurns || 0);
    const errs = Math.max(0, Math.min(total, s.retryCount || 0));
    const oks = total - errs;
    let seq = 1;
    for (let i = 0; i < errs; i++) {
      rows.push({
        ...common,
        client_event_id: uuidv5(`${src}|${s.id}|${seq}`),
        event_seq: seq++,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        event_kind: "tool_call",
        cost_usd: 0,
        duration_ms: 0,
        tool_name: "edit",
        tool_status: "error",
      });
    }
    for (let i = 0; i < oks; i++) {
      rows.push({
        ...common,
        client_event_id: uuidv5(`${src}|${s.id}|${seq}`),
        event_seq: seq++,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        event_kind: "tool_call",
        cost_usd: 0,
        duration_ms: 0,
        tool_name: "edit",
        tool_status: "ok",
      });
    }
  }

  const ch = createClient({
    url: CH_URL,
    database: CH_DATABASE,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  const BATCH = 5000;
  for (let i = 0; i < rows.length; i += BATCH) {
    await ch.insert({ table: "events", values: rows.slice(i, i + BATCH), format: "JSONEachRow" });
  }
  await ch.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
