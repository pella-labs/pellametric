// Auto-backfill: reads the running dev's local grammata data and writes it
// into the CH `events` table under their engineer_id. Runs once per process,
// memoized; callable from getLocalData() when BEMATIST_USE_CH=1.
//
// Local-only: on Railway the server has no access to the dev's filesystem,
// so this is a no-op there (grammata reads return null). Teammates running
// on Railway must have backfilled via the CLI script from their laptop.

import "server-only";

import { createHash } from "node:crypto";
import { createClient } from "@clickhouse/client";
import { buildAnalytics, mergeAll, readClaude, readCodex, readCursor } from "grammata";

const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CH_DATABASE = process.env.CLICKHOUSE_DATABASE ?? "bematist";

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

// Per-identity memo so each teammate's backfill runs once per 10 min per
// process, not on every page load.
const backfillMemo = new Map<string, { at: number; pending: Promise<void> | null }>();
const BACKFILL_TTL_MS = 10 * 60_000;

export async function ensureBackfill(orgId: string, engineerId: string): Promise<void> {
  const key = `${orgId}|${engineerId}`;
  const now = Date.now();
  const slot = backfillMemo.get(key);
  if (slot && now - slot.at < BACKFILL_TTL_MS) return;
  if (slot?.pending) return slot.pending;
  const pending = runBackfill(orgId, engineerId).finally(() => {
    backfillMemo.set(key, { at: Date.now(), pending: null });
  });
  backfillMemo.set(key, { at: slot?.at ?? 0, pending });
  return pending;
}

async function runBackfill(orgId: string, engineerId: string): Promise<void> {
  const deviceId = createHash("sha256")
    .update(`${engineerId}|${process.platform}|${process.arch}`)
    .digest("hex")
    .slice(0, 32);
  try {
    const [claude, codex, cursor] = await Promise.all([
      readClaude().catch(() => null),
      readCodex().catch(() => null),
      readCursor().catch(() => null),
    ]);
    if (!claude && !codex && !cursor) return; // nothing local (Railway case)
    const merged = mergeAll(claude, codex, cursor, null);
    const analytics = buildAnalytics(merged);
    const sessions = analytics.sessionRows;
    if (sessions.length === 0) return;

    // Cursor-specific per-session extras (linesAdded/linesRemoved) that
    // grammata's UnifiedSession drops. Look them up from the raw cursor
    // summary so raw_attrs can carry them into CH.
    const cursorExtras = new Map<string, { linesAdded: number; linesRemoved: number }>();
    if (cursor) {
      for (const c of cursor.sessions) {
        cursorExtras.set(c.sessionId, {
          linesAdded: c.linesAdded || 0,
          linesRemoved: c.linesRemoved || 0,
        });
      }
    }

    // Staggered ts helper: ReplacingMergeTree merges on (org_id, ts, engineer_id),
    // so we need a unique ts per event row within a session — otherwise all the
    // tool_call rows collapse with the llm_request row and take the
    // cost_usd=0 value from the tool_call.
    function tsFor(sessionDate: string, eventSeq: number): string {
      const base = Date.parse(sessionDate) || Date.now();
      const d = new Date(base + eventSeq);
      return d.toISOString().replace("T", " ").replace("Z", "");
    }

    const rows: Record<string, unknown>[] = [];
    for (const s of sessions) {
      const src = s.source === "claude-code" ? "claude-code" : s.source;
      const extras = cursorExtras.get(s.id);
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
        linesAdded: extras?.linesAdded ?? 0,
        linesRemoved: extras?.linesRemoved ?? 0,
      });
      const common = {
        schema_version: 1,
        org_id: orgId,
        engineer_id: engineerId,
        device_id: deviceId,
        source: src,
        source_version: s.version || "",
        fidelity: src === "cursor" ? 2 : 1,
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
        prompt_embedding: [] as number[],
        prompt_index: 0,
        redaction_count: 0,
        pr_number: null,
        commit_sha: null,
        branch: s.gitBranch || null,
        raw_attrs: rawAttrs,
      };
      rows.push({
        ...common,
        ts: tsFor(s.date, 0),
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
          ts: tsFor(s.date, seq),
          client_event_id: uuidv5(`${src}|${s.id}|${seq}`),
          event_seq: seq,
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
        seq++;
      }
      for (let i = 0; i < oks; i++) {
        rows.push({
          ...common,
          ts: tsFor(s.date, seq),
          client_event_id: uuidv5(`${src}|${s.id}|${seq}`),
          event_seq: seq,
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
        seq++;
      }
    }

    const ch = createClient({
      url: CH_URL,
      database: CH_DATABASE,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
    const BATCH = 5000;
    for (let i = 0; i < rows.length; i += BATCH) {
      await ch.insert({
        table: "events",
        values: rows.slice(i, i + BATCH),
        format: "JSONEachRow",
      });
    }
    await ch.close();
  } catch (e) {
    console.error("[ch-backfill] failed:", e);
  }
}
