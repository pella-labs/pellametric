import type { ClickHouseClient } from "@clickhouse/client";
import { ch } from "../client";

export const MV_NAMES = [
  "dev_daily_rollup",
  "team_weekly_rollup",
  "repo_weekly_rollup",
  "prompt_cluster_stats",
] as const;

export const PLAIN_TABLES_FOR_TEST = ["cluster_assignment_mv"] as const;

/** Returns a fresh CH client; caller is responsible for close(). */
export function makeClient(): ClickHouseClient {
  return ch();
}

/** Truncate `events`, all MV tables, and the cluster_assignment_mv plain table
 *  (no-op if table missing). MV tables must be truncated explicitly — CH does NOT
 *  cascade TRUNCATE from source table to materialized views. */
export async function resetState(client: ClickHouseClient): Promise<void> {
  await client.command({ query: "TRUNCATE TABLE IF EXISTS events" });
  for (const mv of MV_NAMES) {
    await client.command({ query: `TRUNCATE TABLE IF EXISTS ${mv}` });
  }
  for (const table of PLAIN_TABLES_FOR_TEST) {
    await client.command({ query: `TRUNCATE TABLE IF EXISTS ${table}` });
  }
}

/** Insert a batch of rows into `events`. Values are partial; defaults fill the rest. */
export type TestEvent = {
  client_event_id: string;
  ts: string; // ISO
  org_id: string;
  engineer_id: string;
  session_id: string;
  event_seq: number;
  source?: string;
  event_kind?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  edit_decision?: string;
  revert_within_24h?: number | null;
  repo_id_hash?: string | null;
  prompt_cluster_id?: string | null;
  commit_sha?: string | null;
  pr_number?: number | null;
  duration_ms?: number;
};

/** Convert ISO8601 timestamps (`2026-04-01T10:00:00.000Z`) to CH DateTime64 format
 *  (`2026-04-01 10:00:00.000`). CH's JSON parser rejects the T separator + Z suffix. */
function toChTimestamp(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}

export async function insertEvents(client: ClickHouseClient, rows: TestEvent[]): Promise<void> {
  const filled = rows.map((r) => ({
    client_event_id: r.client_event_id,
    schema_version: 1,
    ts: toChTimestamp(r.ts),
    org_id: r.org_id,
    engineer_id: r.engineer_id,
    device_id: "test-device",
    source: r.source ?? "claude-code",
    source_version: "1.0.0",
    fidelity: "full",
    cost_estimated: 0,
    tier: "B",
    session_id: r.session_id,
    event_seq: r.event_seq,
    parent_session_id: null,
    gen_ai_system: "anthropic",
    gen_ai_request_model: "claude-opus-4-7",
    gen_ai_response_model: "claude-opus-4-7",
    input_tokens: r.input_tokens ?? 0,
    output_tokens: r.output_tokens ?? 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    event_kind: r.event_kind ?? "llm_request",
    cost_usd: r.cost_usd ?? 0,
    pricing_version: "v1",
    duration_ms: r.duration_ms ?? 0,
    tool_name: "",
    tool_status: "",
    hunk_sha256: null,
    file_path_hash: null,
    edit_decision: r.edit_decision ?? "",
    revert_within_24h: r.revert_within_24h ?? null,
    first_try_failure: null,
    prompt_text: null,
    tool_input: null,
    tool_output: null,
    prompt_abstract: null,
    prompt_embedding: [],
    prompt_index: 0,
    redaction_count: 0,
    pr_number: r.pr_number ?? null,
    commit_sha: r.commit_sha ?? null,
    branch: null,
    raw_attrs: "{}",
    repo_id_hash: r.repo_id_hash ?? null,
    prompt_cluster_id: r.prompt_cluster_id ?? null,
  }));
  await client.insert({
    table: "events",
    values: filled,
    format: "JSONEachRow",
  });
}

/** Query helper returning rows as plain objects. */
export async function query<T = Record<string, unknown>>(
  client: ClickHouseClient,
  sql: string,
): Promise<T[]> {
  const res = await client.query({ query: sql, format: "JSONEachRow" });
  return (await res.json()) as T[];
}
