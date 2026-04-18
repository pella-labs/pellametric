import type { Rng } from "./rng";

export interface SeedOrg {
  id: string;
  slug: string;
  name: string;
  devCount: number;
}

export interface SeedDev {
  orgId: string;
  orgSlug: string;
  userId: string;
  engineerId: string;
  email: string;
  ssoSubject: string;
  deviceId: string;
  /** Skill factor in [0.6, 1.4] — modulates cost/duration and accept rate. */
  skill: number;
}

export interface SeedPlan {
  orgs: SeedOrg[];
  devs: SeedDev[];
  days: number;
  eventsPerDevPerDay: number;
  startDay: Date;
}

/**
 * Build the 3-org / 100-dev control-plane plan. Deterministic.
 *
 * Sizes match the perf brief (CLAUDE.md §Testing Rules + m2-gate A15):
 *  - acme-small:  7 devs
 *  - bolt-mid:   33 devs
 *  - crux-large: 60 devs
 * Total: 100 devs × 90 days × 100 events/day = 900 000 events. Long-tail
 * filler pushes the insert count past 1 000 000 per the INT11 gate.
 */
export function buildPlan(rng: Rng, startDay = new Date("2026-01-15T00:00:00Z")): SeedPlan {
  const orgs: SeedOrg[] = [
    { id: rng.uuid(), slug: "acme-small", name: "Acme Small (7)", devCount: 7 },
    { id: rng.uuid(), slug: "bolt-mid", name: "Bolt Mid (33)", devCount: 33 },
    { id: rng.uuid(), slug: "crux-large", name: "Crux Large (60)", devCount: 60 },
  ];
  const devs: SeedDev[] = [];
  for (const org of orgs) {
    for (let j = 0; j < org.devCount; j++) {
      devs.push({
        orgId: org.id,
        orgSlug: org.slug,
        userId: rng.uuid(),
        engineerId: `eng_${org.slug}_${j.toString().padStart(3, "0")}`,
        email: `dev${j}@${org.slug}.test`,
        ssoSubject: `sub_${org.slug}_${j}`,
        // skill in [0.6, 1.4]; tails get the high-leverage / low-leverage devs
        skill: 0.6 + rng.int(801) / 1000,
        deviceId: `dev-${rng.int(3)}`,
      });
    }
  }
  return { orgs, devs, days: 90, eventsPerDevPerDay: 100, startDay };
}

const SOURCES = ["claude-code", "cursor", "continue", "codex", "opencode"] as const;
const CLUSTERS = [
  "c_refactor",
  "c_bugfix",
  "c_feature",
  "c_test",
  "c_docs",
  "c_debug",
  null,
] as const;
const REPOS = ["repo_app", "repo_web", "repo_sdk", "repo_infra", "repo_docs", null] as const;
const MODELS = [
  "claude-opus-4-7",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  "gpt-5-turbo",
  "gpt-5-codex",
] as const;

const EVENT_KINDS_WEIGHTED = [
  // 65% llm_request, 15% tool_call, 15% code_edit, 5% session markers.
  ...Array(65).fill("llm_request"),
  ...Array(15).fill("tool_call"),
  ...Array(15).fill("code_edit_decision"),
  ...Array(5).fill("session_start"),
] as const;

export interface EventRow {
  client_event_id: string;
  schema_version: number;
  ts: string;
  org_id: string;
  engineer_id: string;
  device_id: string;
  source: string;
  source_version: string;
  fidelity: string;
  cost_estimated: number;
  tier: string;
  session_id: string;
  event_seq: number;
  parent_session_id: string | null;
  gen_ai_system: string;
  gen_ai_request_model: string;
  gen_ai_response_model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  event_kind: string;
  cost_usd: number;
  pricing_version: string;
  duration_ms: number;
  tool_name: string;
  tool_status: string;
  hunk_sha256: string | null;
  file_path_hash: string | null;
  edit_decision: string;
  revert_within_24h: number | null;
  first_try_failure: number | null;
  prompt_text: string | null;
  tool_input: string | null;
  tool_output: string | null;
  prompt_abstract: string | null;
  prompt_embedding: number[];
  prompt_index: number;
  redaction_count: number;
  pr_number: number | null;
  commit_sha: string | null;
  branch: string | null;
  raw_attrs: string;
  repo_id_hash: string | null;
  prompt_cluster_id: string | null;
}

/**
 * Generate `eventsPerDevPerDay` events for one (dev, day) slot. Yields them
 * rather than returning — the seed script batches into 10k-row inserts so
 * memory stays flat at ~50 MB even for 1M total rows.
 */
export function* generateDayForDev(
  rng: Rng,
  dev: SeedDev,
  day: Date,
  eventsInDay: number,
): Generator<EventRow> {
  const dayIso = day.toISOString().slice(0, 10);
  const sessionCount = 1 + rng.int(4);
  // Lay sessions out across the work-day (8am–8pm UTC).
  const sessionStarts: Array<{ id: string; startMinOfDay: number; lenMin: number }> = [];
  for (let s = 0; s < sessionCount; s++) {
    sessionStarts.push({
      id: `sess_${dev.engineerId}_${dayIso}_${s}`,
      startMinOfDay: 8 * 60 + rng.int(12 * 60),
      lenMin: 30 + rng.int(180),
    });
  }

  for (let i = 0; i < eventsInDay; i++) {
    const kind = rng.pick(EVENT_KINDS_WEIGHTED);
    const sess = rng.pick(sessionStarts);
    const minuteInSession = rng.int(Math.max(1, sess.lenMin));
    const totalMinuteOfDay = Math.min(23 * 60 + 59, sess.startMinOfDay + minuteInSession);
    const hh = Math.floor(totalMinuteOfDay / 60);
    const mm = totalMinuteOfDay % 60;
    const ss = rng.int(60);
    // Add fractional ms off of i to avoid RMT dedup collapse.
    const ms = (i * 37) % 1000;
    const ts = `${dayIso} ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;

    const source = rng.pick(SOURCES);
    const model = rng.pick(MODELS);
    const isEdit = kind === "code_edit_decision";
    // skill<1 → higher cost, lower accept. skill>1 → inverse.
    const costBase = rng.lognormal(-2.3, 0.9, 8) / dev.skill;
    const isAccept = isEdit && rng.float() < 0.65 + 0.2 * (dev.skill - 1);
    const isReverted = isAccept && rng.float() < 0.07;
    const inputTok = Math.floor(rng.lognormal(5.5, 0.9, 50_000) / dev.skill);
    const outputTok = Math.floor(rng.lognormal(4.5, 0.9, 20_000) / dev.skill);
    const duration = Math.floor(rng.lognormal(7, 1, 60_000));
    const clusterId = rng.pick(CLUSTERS);
    const repoHash = rng.pick(REPOS);
    const hasPR = rng.float() < 0.12;
    const hasCommit = rng.float() < 0.18;

    yield {
      client_event_id: rng.uuid(),
      schema_version: 1,
      ts,
      org_id: dev.orgId,
      engineer_id: dev.engineerId,
      device_id: dev.deviceId,
      source,
      source_version: "1.0.0",
      fidelity: source === "cursor" ? "estimated" : "full",
      cost_estimated: source === "cursor" ? 1 : 0,
      tier: "B",
      session_id: sess.id,
      event_seq: i,
      parent_session_id: null,
      gen_ai_system: model.startsWith("claude") ? "anthropic" : "openai",
      gen_ai_request_model: model,
      gen_ai_response_model: model,
      input_tokens: inputTok,
      output_tokens: outputTok,
      cache_read_input_tokens: Math.floor(inputTok * 0.3),
      cache_creation_input_tokens: Math.floor(inputTok * 0.1),
      event_kind:
        kind === "session_start" ? (rng.float() < 0.5 ? "session_start" : "session_end") : kind,
      cost_usd: Number(costBase.toFixed(6)),
      pricing_version: "litellm-2026-04-01",
      duration_ms: duration,
      tool_name: kind === "tool_call" ? rng.pick(["Edit", "Read", "Bash", "Grep", "Write"]) : "",
      tool_status: kind === "tool_call" ? (rng.float() < 0.92 ? "ok" : "error") : "",
      hunk_sha256: isEdit ? `h_${rng.uuid().slice(0, 16)}` : null,
      file_path_hash: isEdit ? `fp_${rng.int(1000)}` : null,
      edit_decision: isEdit ? (isAccept ? "accept" : rng.float() < 0.85 ? "reject" : "modify") : "",
      revert_within_24h: isAccept ? (isReverted ? 1 : 0) : null,
      first_try_failure: kind === "tool_call" ? (rng.float() < 0.08 ? 1 : 0) : null,
      prompt_text: null,
      tool_input: null,
      tool_output: null,
      prompt_abstract: null,
      prompt_embedding: [],
      prompt_index: 0,
      redaction_count: 0,
      pr_number: hasPR ? rng.int(5000) : null,
      commit_sha: hasCommit ? `sha_${rng.uuid().slice(0, 12)}` : null,
      branch: null,
      raw_attrs: "{}",
      repo_id_hash: repoHash,
      prompt_cluster_id: clusterId,
    };
  }
}
