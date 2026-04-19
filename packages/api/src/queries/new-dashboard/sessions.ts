import { assertRole, type Ctx } from "../../auth";
import { useFixtures } from "../../env";
import type {
  SessionDetailInput,
  SessionDetailOutput,
  SessionLinkedPr,
  SessionsFeedInput,
  SessionsFeedOutput,
  SessionsFeedRow,
  SessionTimelineEvent,
  SessionToolBreakdown,
} from "../../schemas/new-dashboard";
import { buildCommonClauses, hash8, round2, seedFromString, WINDOW_DAYS } from "./_shared";

const TIMELINE_CAP = 500;

export async function sessionsFeed(
  ctx: Ctx,
  input: SessionsFeedInput,
): Promise<SessionsFeedOutput> {
  assertRole(ctx, ["admin", "manager", "engineer", "viewer"]);
  if (useFixtures()) return sessionsFeedFixture(ctx, input);
  return sessionsFeedReal(ctx, input);
}

async function sessionsFeedFixture(
  ctx: Ctx,
  input: SessionsFeedInput,
): Promise<SessionsFeedOutput> {
  const seed = seedFromString(`${ctx.tenant_id}|feed|${input.window}|${input.cursor ?? ""}`);
  const rows: SessionsFeedRow[] = [];
  for (let i = 0; i < input.page_size; i++) {
    const sid = `fx-sess-${seed.toString(16)}-${i}`;
    const startedAt = new Date(Date.now() - i * 45 * 60 * 1000);
    rows.push({
      session_id: sid,
      source: i % 3 === 0 ? "codex" : "claude-code",
      started_at: startedAt.toISOString(),
      duration_minutes: 8 + (i % 45),
      engineer_id_hash: hash8(`${ctx.tenant_id}:fx-${i % 4}`),
      branch: i % 2 === 0 ? "main" : `feature/x-${i}`,
      repo_full_name: "pella-labs/bematist",
      linked_pr_numbers: i % 5 === 0 ? [200 - i] : [],
      spend_usd: round2(0.5 + (i % 10) * 0.3),
      tokens_in: 18000 + i * 300,
      tokens_out: 4200 + i * 50,
      tool_calls: 12 + (i % 40),
      tool_errors: i % 6 === 0 ? 1 : 0,
      model: i % 3 === 0 ? "gpt-5.3-codex" : "claude-sonnet-4-6",
    });
  }
  return {
    page_info: { cursor: null, has_more: false, total_approx: input.page_size },
    rows,
  };
}

async function sessionsFeedReal(ctx: Ctx, input: SessionsFeedInput): Promise<SessionsFeedOutput> {
  const days = WINDOW_DAYS[input.window];
  const { clauses, params } = buildCommonClauses(ctx.tenant_id, days, input);

  // Cursor: the ISO timestamp of the last session's started_at from the
  // previous page. Ordering is session_started_at DESC so the cursor
  // narrows the window instead of counting offsets.
  let cursorClauses = "";
  if (input.cursor) {
    cursorClauses = "AND min_ts < {cursor_ts:DateTime64(3)}";
    params.cursor_ts = input.cursor;
  }

  const rows = await ctx.db.ch.query<{
    session_id: string;
    source: string;
    started_at: string;
    ended_at: string;
    duration_minutes: number | string;
    engineer_id: string;
    engineer_id_hash: string;
    branch: string | null;
    commit_sha: string | null;
    spend_usd: number | string;
    tokens_in: number | string;
    tokens_out: number | string;
    tool_calls: number | string;
    tool_errors: number | string;
    model: string | null;
  }>(
    `WITH session_rollup AS (
       SELECT
         session_id,
         any(source) AS source,
         min(ts) AS min_ts,
         max(ts) AS max_ts,
         (dateDiff('minute', min(ts), max(ts))) AS duration_minutes,
         engineer_id,
         any(branch) AS branch,
         any(commit_sha) AS commit_sha,
         sum(cost_usd) AS spend_usd,
         sum(input_tokens) AS tokens_in,
         sum(output_tokens) AS tokens_out,
         countIf(event_kind = 'tool_call') AS tool_calls,
         countIf(tool_status = 'error') AS tool_errors,
         coalesce(
           nullIf(any(gen_ai_response_model), ''),
           nullIf(any(gen_ai_request_model), '')
         ) AS model
       FROM events
       WHERE ${clauses.join(" AND ")}
         AND session_id != ''
       GROUP BY session_id, engineer_id
     )
     SELECT
       session_id,
       source,
       toString(min_ts) AS started_at,
       toString(max_ts) AS ended_at,
       duration_minutes,
       engineer_id,
       substring(lower(hex(cityHash64(engineer_id))), 1, 8) AS engineer_id_hash,
       branch,
       commit_sha,
       round(spend_usd, 6) AS spend_usd,
       tokens_in,
       tokens_out,
       tool_calls,
       tool_errors,
       model
     FROM session_rollup
     WHERE 1=1 ${cursorClauses}
     ORDER BY min_ts DESC
     LIMIT {page_size:UInt32}`,
    { ...params, page_size: input.page_size + 1 },
  );

  const hasMore = rows.length > input.page_size;
  const visible = hasMore ? rows.slice(0, input.page_size) : rows;

  // Batch-lookup repo + PRs for all visible sessions' commit_shas in one PG query.
  const shas = [...new Set(visible.map((r) => r.commit_sha).filter((s): s is string => !!s))];
  const prByRepoBySha = new Map<string, { full_name: string; pr_numbers: number[] }>();
  if (shas.length > 0) {
    const prRows = await ctx.db.pg
      .query<{
        head_sha: string | null;
        merge_commit_sha: string | null;
        pr_number: number;
        full_name: string | null;
      }>(
        `SELECT pr.head_sha, pr.merge_commit_sha, pr.pr_number, r.full_name
           FROM github_pull_requests pr
           LEFT JOIN repos r ON r.provider = 'github' AND r.provider_repo_id = pr.provider_repo_id
          WHERE pr.tenant_id = $1
            AND (pr.head_sha = ANY($2::text[]) OR pr.merge_commit_sha = ANY($2::text[]))`,
        [ctx.tenant_id, shas],
      )
      .catch(() => []);
    for (const p of prRows) {
      const matchSha = shas.find((s) => s === p.head_sha || s === p.merge_commit_sha);
      if (!matchSha) continue;
      const entry = prByRepoBySha.get(matchSha) ?? {
        full_name: p.full_name ?? "",
        pr_numbers: [],
      };
      if (p.full_name && !entry.full_name) entry.full_name = p.full_name;
      entry.pr_numbers.push(Number(p.pr_number));
      prByRepoBySha.set(matchSha, entry);
    }
  }

  const mapped: SessionsFeedRow[] = visible.map((r) => {
    const link = r.commit_sha ? prByRepoBySha.get(r.commit_sha) : undefined;
    return {
      session_id: r.session_id,
      source: r.source,
      started_at: new Date(r.started_at).toISOString(),
      duration_minutes: Number(r.duration_minutes),
      engineer_id_hash: r.engineer_id_hash,
      branch: r.branch ?? null,
      repo_full_name: link?.full_name ?? null,
      linked_pr_numbers: link?.pr_numbers ?? [],
      spend_usd: round2(Number(r.spend_usd)),
      tokens_in: Number(r.tokens_in),
      tokens_out: Number(r.tokens_out),
      tool_calls: Number(r.tool_calls),
      tool_errors: Number(r.tool_errors),
      model: r.model ?? null,
    };
  });

  const last = visible[visible.length - 1];
  return {
    page_info: {
      cursor: hasMore && last ? new Date(last.started_at).toISOString() : null,
      has_more: hasMore,
      total_approx: mapped.length,
    },
    rows: mapped,
  };
}

// ---- sessionDetail -------------------------------------------------------

export async function sessionDetail(
  ctx: Ctx,
  input: SessionDetailInput,
): Promise<SessionDetailOutput> {
  assertRole(ctx, ["admin", "manager", "engineer", "viewer"]);
  if (useFixtures()) return sessionDetailFixture(ctx, input);
  return sessionDetailReal(ctx, input);
}

async function sessionDetailFixture(
  _ctx: Ctx,
  input: SessionDetailInput,
): Promise<SessionDetailOutput> {
  const startedAt = new Date(Date.now() - 3 * 3600_000);
  const timeline: SessionTimelineEvent[] = [];
  for (let i = 0; i < 40; i++) {
    timeline.push({
      ts: new Date(startedAt.getTime() + i * 90_000).toISOString(),
      event_kind: i === 0 ? "session_start" : i % 4 === 0 ? "tool_call" : "llm_response",
      tool_name: i % 4 === 0 ? "Bash" : undefined,
      duration_ms: 200 + i * 20,
      cost_usd: i % 5 === 0 ? round2(0.03 + i * 0.005) : undefined,
    });
  }
  return {
    header: {
      session_id: input.session_id,
      started_at: startedAt.toISOString(),
      ended_at: new Date(startedAt.getTime() + 40 * 90_000).toISOString(),
      engineer_id_hash: hash8(input.session_id),
      repo_full_name: "pella-labs/bematist",
      branch: "main",
      model: "claude-sonnet-4-6",
      spend_usd: 2.84,
      total_events: timeline.length,
    },
    timeline,
    timeline_truncated: false,
    linked_prs: [
      {
        repo: "pella-labs/bematist",
        pr_number: 99,
        title_hash: "a1b2c3d4",
        state: "merged",
        merged_at: new Date().toISOString(),
        additions: 120,
        deletions: 30,
      },
    ],
    tool_breakdown: [
      { tool_name: "Bash", calls: 12, errors: 1, total_ms: 9200 },
      { tool_name: "Read", calls: 10, errors: 0, total_ms: 3100 },
      { tool_name: "Edit", calls: 6, errors: 0, total_ms: 2800 },
    ],
  };
}

async function sessionDetailReal(
  ctx: Ctx,
  input: SessionDetailInput,
): Promise<SessionDetailOutput> {
  const headerRows = await ctx.db.ch.query<{
    started_at: string;
    ended_at: string;
    engineer_id: string;
    engineer_id_hash: string;
    branch: string | null;
    commit_sha: string | null;
    model: string | null;
    spend_usd: number | string;
    total_events: number | string;
  }>(
    `SELECT
       toString(min(ts)) AS started_at,
       toString(max(ts)) AS ended_at,
       any(engineer_id) AS engineer_id,
       any(substring(lower(hex(cityHash64(engineer_id))), 1, 8)) AS engineer_id_hash,
       any(branch) AS branch,
       any(commit_sha) AS commit_sha,
       coalesce(
         nullIf(any(gen_ai_response_model), ''),
         nullIf(any(gen_ai_request_model), '')
       ) AS model,
       round(sum(cost_usd), 6) AS spend_usd,
       count() AS total_events
     FROM events
     WHERE org_id = {tid:String} AND session_id = {sid:String}`,
    { tid: ctx.tenant_id, sid: input.session_id },
  );
  const h = headerRows[0];
  if (!h) {
    return {
      header: {
        session_id: input.session_id,
        started_at: new Date().toISOString(),
        ended_at: null,
        engineer_id_hash: "",
        repo_full_name: null,
        branch: null,
        model: null,
        spend_usd: 0,
        total_events: 0,
      },
      timeline: [],
      timeline_truncated: false,
      linked_prs: [],
      tool_breakdown: [],
    };
  }

  const timelineRows = await ctx.db.ch.query<{
    ts: string;
    event_kind: string;
    tool_name: string;
    duration_ms: number | string;
    cost_usd: number | string;
  }>(
    `SELECT
       toString(ts) AS ts,
       event_kind,
       tool_name,
       duration_ms,
       cost_usd
     FROM events
     WHERE org_id = {tid:String} AND session_id = {sid:String}
     ORDER BY ts ASC
     LIMIT {cap:UInt32}`,
    { tid: ctx.tenant_id, sid: input.session_id, cap: TIMELINE_CAP + 1 },
  );
  const truncated = timelineRows.length > TIMELINE_CAP;
  const timeline: SessionTimelineEvent[] = timelineRows.slice(0, TIMELINE_CAP).map((r) => ({
    ts: new Date(r.ts).toISOString(),
    event_kind: r.event_kind,
    tool_name: r.tool_name || undefined,
    duration_ms: Number(r.duration_ms) || undefined,
    cost_usd: Number(r.cost_usd) || undefined,
  }));

  const toolRows = await ctx.db.ch.query<{
    tool_name: string;
    calls: number | string;
    errors: number | string;
    total_ms: number | string;
  }>(
    `SELECT
       tool_name,
       count() AS calls,
       countIf(tool_status = 'error') AS errors,
       sum(duration_ms) AS total_ms
     FROM events
     WHERE org_id = {tid:String}
       AND session_id = {sid:String}
       AND event_kind IN ('tool_call', 'tool_result')
       AND tool_name != ''
     GROUP BY tool_name
     ORDER BY calls DESC
     LIMIT 20`,
    { tid: ctx.tenant_id, sid: input.session_id },
  );
  const tool_breakdown: SessionToolBreakdown[] = toolRows.map((r) => ({
    tool_name: r.tool_name,
    calls: Number(r.calls),
    errors: Number(r.errors),
    total_ms: Number(r.total_ms),
  }));

  const linked_prs: SessionLinkedPr[] = [];
  let repo_full_name: string | null = null;
  if (h.commit_sha) {
    const prRows = await ctx.db.pg
      .query<{
        pr_number: number;
        state: string;
        merged_at: string | null;
        additions: number;
        deletions: number;
        title_hash: string;
        full_name: string | null;
      }>(
        `SELECT pr.pr_number, pr.state, pr.merged_at::text AS merged_at,
                pr.additions, pr.deletions,
                encode(pr.title_hash, 'hex') AS title_hash,
                r.full_name
           FROM github_pull_requests pr
           LEFT JOIN repos r ON r.provider = 'github' AND r.provider_repo_id = pr.provider_repo_id
          WHERE pr.tenant_id = $1
            AND (pr.head_sha = $2 OR pr.merge_commit_sha = $2)`,
        [ctx.tenant_id, h.commit_sha],
      )
      .catch(() => []);
    for (const p of prRows) {
      repo_full_name = repo_full_name ?? p.full_name ?? null;
      linked_prs.push({
        repo: p.full_name ?? "",
        pr_number: Number(p.pr_number),
        title_hash: p.title_hash.slice(0, 8),
        state: (p.state === "merged" || p.state === "closed" || p.state === "open"
          ? p.state
          : "open") as "open" | "merged" | "closed",
        merged_at: p.merged_at,
        additions: Number(p.additions ?? 0),
        deletions: Number(p.deletions ?? 0),
      });
    }
  }

  return {
    header: {
      session_id: input.session_id,
      started_at: new Date(h.started_at).toISOString(),
      ended_at: new Date(h.ended_at).toISOString(),
      engineer_id_hash: h.engineer_id_hash,
      repo_full_name,
      branch: h.branch,
      model: h.model,
      spend_usd: round2(Number(h.spend_usd)),
      total_events: Number(h.total_events),
    },
    timeline,
    timeline_truncated: truncated,
    linked_prs,
    tool_breakdown,
  };
}
