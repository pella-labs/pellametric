// Gate 4 / 5 — nightly invariant scan over ClickHouse `events` rows.
//
// Per CLAUDE.md §Testing Rules INT10: "nightly invariant scan proves zero raw
// secrets or forbidden fields in ClickHouse rows". This gate runs the same
// scan on demand for every CI run, so an ingest regression that lets a raw
// secret reach storage fails the privacy workflow before it lands.
//
// Strategy
// --------
// 1. Connect to ClickHouse using `CLICKHOUSE_URL` (the privacy workflow runs a
//    CH service container).
// 2. Seed three rows that EXERCISE the invariant:
//      - SEED_GOOD: clean row (negative control).
//      - SEED_BENIGN: clean row, second negative control.
//      - SEED_BAD: raw_attrs JSON with `rawPrompt` key (positive control).
// 3. Scan the past 7 days for raw-secret literals + forbidden-field keys in
//    `raw_attrs`. Assert: SEED_BAD is flagged AND no other row is flagged.
//
// If CH is unreachable the live tests SKIP with a structured warning. The
// privacy workflow uses a CH service container so production CI always runs
// the gate; local devs without docker still get gates 1/2/3/5.
//
// SQL equivalent for ops dashboards / cron — see contract 08 §Nightly invariant.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { containsForbiddenField, FORBIDDEN_FIELDS } from "@bematist/schema";
import type { ClickHouseClient } from "@clickhouse/client";

// High-confidence secret regexes — narrow on purpose. The wider redaction-engine
// rule pack is exercised by Gate 1; this file's job is to catch obvious raw-secret
// leakage in already-stored rows, not to re-implement the engine.
const RAW_SECRET_REGEXES: Array<[string, RegExp]> = [
  ["aws_access_key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["github_pat", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,251}\b/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ["slack_webhook", /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/],
  ["private_key", /-----BEGIN (RSA |OPENSSH |EC |ENCRYPTED )?PRIVATE KEY-----/],
];

interface EventRow {
  client_event_id: string;
  prompt_text: string | null;
  tool_input: string | null;
  tool_output: string | null;
  prompt_abstract: string | null;
  raw_attrs: string | null;
}

interface ScanFinding {
  row_id: string;
  column: string;
  rule: string;
}

function scanRow(row: EventRow): ScanFinding[] {
  const out: ScanFinding[] = [];
  const cols: Array<
    ["prompt_text" | "tool_input" | "tool_output" | "prompt_abstract", string | null]
  > = [
    ["prompt_text", row.prompt_text],
    ["tool_input", row.tool_input],
    ["tool_output", row.tool_output],
    ["prompt_abstract", row.prompt_abstract],
  ];
  for (const [col, val] of cols) {
    if (typeof val !== "string" || val.length === 0) continue;
    for (const [rule, rx] of RAW_SECRET_REGEXES) {
      if (rx.test(val)) out.push({ row_id: row.client_event_id, column: col, rule });
    }
  }
  if (typeof row.raw_attrs === "string" && row.raw_attrs.length > 0) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(row.raw_attrs);
    } catch {
      out.push({ row_id: row.client_event_id, column: "raw_attrs", rule: "unparseable_json" });
    }
    if (parsed !== null) {
      const forbidden = containsForbiddenField(parsed);
      if (forbidden !== null) {
        out.push({
          row_id: row.client_event_id,
          column: "raw_attrs",
          rule: `forbidden_field:${forbidden}`,
        });
      }
    }
    for (const [rule, rx] of RAW_SECRET_REGEXES) {
      if (rx.test(row.raw_attrs)) {
        out.push({ row_id: row.client_event_id, column: "raw_attrs", rule });
      }
    }
  }
  return out;
}

// Gate runs against live ClickHouse when CLICKHOUSE_URL is exported. Local
// devs without docker get a structured skip; CI sets CLICKHOUSE_URL via the
// privacy workflow's `env:` block so gate 4 is merge-blocking in CI. The
// realWriter live-test pattern (apps/ingest/src/clickhouse/realWriter.test.ts)
// is the established precedent for env-driven gating.
const CH_LIVE = process.env.CLICKHOUSE_URL !== undefined;
const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CH_DATABASE = process.env.CLICKHOUSE_DATABASE ?? "bematist";

const SEED_GOOD_ID = "00000000-0000-4000-8000-aaaaaaaaaaaa";
const SEED_BAD_ID = "00000000-0000-4000-8000-bbbbbbbbbbbb";
const SEED_BENIGN_ID = "00000000-0000-4000-8000-cccccccccccc";

let chClient: ClickHouseClient | null = null;

async function connect(): Promise<void> {
  const { createClient } = await import("@clickhouse/client");
  chClient = createClient({ url: CH_URL, database: CH_DATABASE, request_timeout: 5000 });
}

async function seedRows(): Promise<void> {
  if (!chClient) return;
  await chClient.command({
    // Using ALTER TABLE DELETE because the events table has projections
    // (lightweight_mutation_projection_mode defaults to THROW). mutations_sync=2
    // makes it block until applied so the seed step is deterministic.
    query: `ALTER TABLE events DELETE WHERE client_event_id IN ('${SEED_GOOD_ID}', '${SEED_BAD_ID}', '${SEED_BENIGN_ID}') SETTINGS mutations_sync=2`,
  });

  const { insertEvents } = await import("../../../packages/schema/clickhouse/__tests__/_harness");
  const ts = "2026-04-17T12:00:00.000Z";
  await insertEvents(chClient, [
    {
      client_event_id: SEED_GOOD_ID,
      ts,
      org_id: "org_privacy_gate",
      engineer_id: "eng_a",
      session_id: "s_good",
      event_seq: 1,
    },
    {
      client_event_id: SEED_BENIGN_ID,
      ts,
      org_id: "org_privacy_gate",
      engineer_id: "eng_b",
      session_id: "s_benign",
      event_seq: 1,
    },
  ]);
  // Positive-control row — direct insert to bypass the harness's safe defaults.
  await chClient.insert({
    table: "events",
    format: "JSONEachRow",
    values: [
      {
        client_event_id: SEED_BAD_ID,
        schema_version: 1,
        ts: "2026-04-17 12:00:00.000",
        org_id: "org_privacy_gate",
        engineer_id: "eng_c",
        device_id: "d_bad",
        source: "claude-code",
        source_version: "1.0.0",
        fidelity: "full",
        cost_estimated: 0,
        tier: "B",
        session_id: "s_bad",
        event_seq: 1,
        parent_session_id: null,
        gen_ai_system: "anthropic",
        gen_ai_request_model: "claude-opus-4-7",
        gen_ai_response_model: "claude-opus-4-7",
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        event_kind: "llm_request",
        cost_usd: 0,
        pricing_version: "v1",
        duration_ms: 0,
        tool_name: "",
        tool_status: "",
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
        branch: null,
        raw_attrs: JSON.stringify({ rawPrompt: "leak" }),
        repo_id_hash: null,
        prompt_cluster_id: null,
      },
    ],
  });
}

beforeAll(async () => {
  if (!CH_LIVE) return;
  await connect();
  if (chClient) await seedRows();
});

afterAll(async () => {
  if (chClient) {
    await chClient.command({
      // Using ALTER TABLE DELETE because the events table has projections
      // (lightweight_mutation_projection_mode defaults to THROW). mutations_sync=2
      // makes it block until applied so the seed step is deterministic.
      query: `ALTER TABLE events DELETE WHERE client_event_id IN ('${SEED_GOOD_ID}', '${SEED_BAD_ID}', '${SEED_BENIGN_ID}') SETTINGS mutations_sync=2`,
    });
    await chClient.close();
    chClient = null;
  }
});

// biome-ignore lint/suspicious/noExplicitAny: bun:test exposes skipIf at runtime
const runIfLive = (test as any).skipIf
  ? // biome-ignore lint/suspicious/noExplicitAny: same
    (test as any).skipIf(!CH_LIVE)
  : test;

describe("PRIVACY GATE 4/5 — nightly invariant scan over ClickHouse events", () => {
  test("scanRow detects rawPrompt forbidden key in raw_attrs (unit positive control)", () => {
    const findings = scanRow({
      client_event_id: "synthetic",
      prompt_text: null,
      tool_input: null,
      tool_output: null,
      prompt_abstract: null,
      raw_attrs: JSON.stringify({ messages: [{ content: "x" }] }),
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.rule.startsWith("forbidden_field:messages"))).toBe(true);
  });

  test("scanRow detects raw secret literal in prompt_text (unit positive control)", () => {
    const findings = scanRow({
      client_event_id: "synthetic",
      prompt_text: "Use AKIAIOSFODNN7EXAMPLE for the deploy.",
      tool_input: null,
      tool_output: null,
      prompt_abstract: null,
      raw_attrs: null,
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.rule === "aws_access_key")).toBe(true);
  });

  test("scanRow accepts a clean row (unit negative control)", () => {
    const findings = scanRow({
      client_event_id: "synthetic",
      prompt_text: "How do I bind a CTE in this query?",
      tool_input: null,
      tool_output: null,
      prompt_abstract: null,
      raw_attrs: JSON.stringify({ source_version: "1.0.0", schema_version: 1 }),
    });
    expect(findings).toEqual([]);
  });

  test("contract-08 forbidden fields are recognised by containsForbiddenField (drift guard)", () => {
    for (const f of FORBIDDEN_FIELDS) {
      expect(containsForbiddenField({ [f]: "x" })).toBe(f);
    }
  });

  runIfLive("live ClickHouse — seeded bad row IS flagged (positive control)", async () => {
    if (!chClient) throw new Error("CH client missing despite tryConnect()");
    const res = await chClient.query({
      query: `SELECT client_event_id, prompt_text, tool_input, tool_output, prompt_abstract, raw_attrs
              FROM events WHERE client_event_id = '${SEED_BAD_ID}'`,
      format: "JSONEachRow",
    });
    const rows = (await res.json()) as EventRow[];
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("missing row");
    const findings = scanRow(row);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.rule.startsWith("forbidden_field:rawPrompt"))).toBe(true);
  });

  runIfLive(
    "live ClickHouse — every row in events except the seeded positive control is clean",
    async () => {
      if (!chClient) throw new Error("CH client missing despite tryConnect()");
      const res = await chClient.query({
        query: `SELECT client_event_id, prompt_text, tool_input, tool_output, prompt_abstract, raw_attrs
                FROM events
                WHERE ts >= now() - INTERVAL 7 DAY
                  AND client_event_id != '${SEED_BAD_ID}'`,
        format: "JSONEachRow",
      });
      const rows = (await res.json()) as EventRow[];
      const allFindings: ScanFinding[] = [];
      for (const row of rows) {
        allFindings.push(...scanRow(row));
      }
      if (allFindings.length > 0) {
        // Name row ids + rules; never echo the secret value.
        console.error(
          `[privacy-gate-4] LEAK in events table: ${allFindings
            .map((f) => `${f.row_id}/${f.column}/${f.rule}`)
            .join(" | ")}`,
        );
      }
      expect(allFindings).toEqual([]);
    },
  );
});
