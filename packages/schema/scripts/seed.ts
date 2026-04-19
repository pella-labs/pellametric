import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { ch } from "../clickhouse/client";

const pgUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5435/bematist";
const sql = postgres(pgUrl, { max: 1 });
const client = ch();

// Deterministic LCG for reproducible fixtures.
let rngState = 0xdecaf;
const rand = () => {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState;
};
const randInt = (max: number) => rand() % max;

// Truncate PG + CH (idempotent).
await sql`TRUNCATE TABLE policies, developers, users, orgs RESTART IDENTITY CASCADE`;
await client.command({ query: "TRUNCATE TABLE events" });
await client.command({ query: "TRUNCATE TABLE cluster_assignment_mv" });
// MV data is cleared by events truncate? No — explicit truncate each.
for (const mv of [
  "dev_daily_rollup",
  "team_weekly_rollup",
  "repo_weekly_rollup",
  "prompt_cluster_stats",
]) {
  await client.command({ query: `TRUNCATE TABLE IF EXISTS ${mv}` });
}

// --- Orgs
type Org = { id: string; slug: string; name: string };
const orgs: Org[] = [
  { id: randomUUID(), slug: "acme", name: "Acme Co (small)" },
  { id: randomUUID(), slug: "bolt", name: "Bolt Inc (medium)" },
  { id: randomUUID(), slug: "crux", name: "Crux Corp (large)" },
];
for (const o of orgs) {
  await sql`INSERT INTO orgs (id, slug, name) VALUES (${o.id}, ${o.slug}, ${o.name})`;
  // Default tier-B policy per org — ingest rejects events with ORG_POLICY_MISSING otherwise.
  await sql`INSERT INTO policies (org_id, tier_default) VALUES (${o.id}, 'B')`;
}

// --- Users + developers (2 + 4 + 6 = 12 across 3 orgs)
type Dev = { org_id: string; engineer_id: string };
const devs: Dev[] = [];
for (const [i, org] of orgs.entries()) {
  const n = i === 0 ? 2 : i === 1 ? 4 : 6;
  for (let j = 0; j < n; j++) {
    const userId = randomUUID();
    const engineerHash = `eng_${org.slug}_${j}`;
    await sql`INSERT INTO users (id, org_id, sso_subject, email)
              VALUES (${userId}, ${org.id}, ${`sub_${org.slug}_${j}`}, ${`dev${j}@${org.slug}.test`})`;
    await sql`INSERT INTO developers (org_id, user_id, stable_hash)
              VALUES (${org.id}, ${userId}, ${engineerHash})`;
    devs.push({ org_id: org.id, engineer_id: engineerHash });
  }
}

// --- Events — 8k events over 30 days, distributed across all devs.
const sources = ["claude-code", "cursor", "continue"];
const clusterIds = ["c_refactor", "c_bugfix", "c_feature", "c_test", null];
const repoHashes = ["repo_app", "repo_web", "repo_sdk", null];

const events: Record<string, unknown>[] = [];
for (let i = 0; i < 8000; i++) {
  const dev = devs[randInt(devs.length)];
  const dayOffset = randInt(30);
  const hour = randInt(24);
  const minute = randInt(60);
  const second = i % 60; // makes ts unique enough to minimize RMT dedup
  const isEdit = randInt(10) < 2;
  const isAccept = isEdit && randInt(10) < 7;
  const actualDay = 15 + dayOffset;
  const month = actualDay > 31 ? 4 : 3;
  const dayInMonth = actualDay > 31 ? actualDay - 31 : actualDay;
  const finalTs = `2026-${String(month).padStart(2, "0")}-${String(dayInMonth).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000`;

  events.push({
    client_event_id: randomUUID(),
    schema_version: 1,
    ts: finalTs,
    org_id: dev.org_id,
    engineer_id: dev.engineer_id,
    device_id: `dev-${randInt(3)}`,
    source: sources[randInt(sources.length)],
    source_version: "1.0.0",
    fidelity: "full",
    cost_estimated: 0,
    tier: "B",
    session_id: `sess_${randInt(200)}`,
    event_seq: i % 100,
    parent_session_id: null,
    gen_ai_system: "anthropic",
    gen_ai_request_model: "claude-opus-4-7",
    gen_ai_response_model: "claude-opus-4-7",
    input_tokens: randInt(5000),
    output_tokens: randInt(2000),
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    event_kind: isEdit ? "code_edit_decision" : "llm_request",
    cost_usd: randInt(100) / 100,
    pricing_version: "v1",
    duration_ms: randInt(5000),
    tool_name: "",
    tool_status: "",
    hunk_sha256: null,
    file_path_hash: null,
    edit_decision: isEdit ? (isAccept ? "accept" : "reject") : "",
    revert_within_24h: isAccept ? (randInt(10) < 1 ? 1 : 0) : null,
    first_try_failure: null,
    prompt_text: null,
    tool_input: null,
    tool_output: null,
    prompt_abstract: null,
    prompt_embedding: [],
    prompt_index: 0,
    redaction_count: 0,
    pr_number: randInt(10) < 3 ? randInt(500) : null,
    commit_sha: randInt(10) < 4 ? `sha_${randInt(1000)}` : null,
    branch: null,
    raw_attrs: "{}",
    repo_id_hash: repoHashes[randInt(repoHashes.length)],
    prompt_cluster_id: clusterIds[randInt(clusterIds.length)],
  });
}
await client.insert({ table: "events", values: events, format: "JSONEachRow" });

await sql.end();
await client.close();
