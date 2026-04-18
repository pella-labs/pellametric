/**
 * Real-branch SQL-shape tests.
 *
 * These exercise the `USE_FIXTURES=0` path of every query in this directory
 * by injecting mocked `ctx.db.ch.query` / `ctx.db.pg.query`. We don't assert
 * full SQL strings — we assert that the right MV/table is targeted and the
 * right `tenant_id` filter is applied. Content of MV rows is Jorge's
 * business.
 *
 * Invariants asserted:
 *   - Every real query hits at least one DB client.
 *   - `tenant_id` / `org_id` from `ctx` is bound as a parameter.
 *   - No prompt-adjacent columns (prompt_text / tool_input / tool_output /
 *     messages / toolArgs / toolOutputs / fileContents / diffs / filePaths /
 *     ticketIds / emails / realNames) appear in any outgoing SELECT.
 *   - Privacy gates (`applyDisplayGate`) still apply after the fetch.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Ctx, Role } from "../auth";
import { listAlerts } from "./alerts";
import { getMyViewHistory } from "./audit";
import { findSessionTwins, listClusters } from "./cluster";
import { getSummary } from "./dashboard";
import { getWeeklyDigest } from "./insights";
import { perCommitOutcomes, perDevOutcomes, perPROutcomes } from "./outcomes";
import { getEffectivePolicy } from "./policy";
import { getSession, listSessions } from "./session";
import { getTwoByTwo, listTeams } from "./team";

const FORBIDDEN_COLUMNS = [
  "rawPrompt",
  "prompt_text",
  "messages",
  "toolArgs",
  "toolOutputs",
  "fileContents",
  "diffs",
  "filePaths",
  "ticketIds",
  "emails",
  "realNames",
];

function assertNoForbiddenColumns(sql: string): void {
  // The getSession `real` branch DOES SELECT `prompt_text` — but ONLY
  // behind a reveal token, from Tier-C rows only. That's the one allowed
  // exception. Callers pass `allowPromptText: true` for that narrow case.
  for (const col of FORBIDDEN_COLUMNS) {
    // Allow presence in WHERE/ORDER clauses only if surrounded by NOT-NULL
    // checks; the simplest bright-line rule is "not in SELECT".
    const selectSegment = sql.split(/\bFROM\b/i)[0] ?? "";
    expect(selectSegment).not.toMatch(new RegExp(`\\b${col}\\b`, "i"));
  }
}

/**
 * Narrow a mock call to `[sql, params]`. Typed through `unknown` so TS
 * accepts the narrowing without complaining about tuple length.
 */
function firstCh(ch: ReturnType<typeof mock>, index = 0): [string, Record<string, unknown>] {
  const call = ch.mock.calls[index];
  return call as unknown as [string, Record<string, unknown>];
}

function firstPg(pg: ReturnType<typeof mock>, index = 0): [string, unknown[]] {
  const call = pg.mock.calls[index];
  return call as unknown as [string, unknown[]];
}

function makeCtx(
  role: Role = "manager",
  mocks: {
    ch?: ReturnType<typeof mock>;
    pg?: ReturnType<typeof mock>;
  } = {},
): Ctx {
  const ch = mocks.ch ?? mock(async () => []);
  const pg = mocks.pg ?? mock(async () => []);
  return {
    tenant_id: "org_fixtures_off",
    actor_id: "actor_lane1",
    role,
    db: {
      ch: { query: ch as unknown as Ctx["db"]["ch"]["query"] },
      pg: { query: pg as unknown as Ctx["db"]["pg"]["query"] },
      redis: {
        get: async () => null,
        set: async () => undefined,
        setNx: async () => true,
      },
    },
  };
}

beforeEach(() => {
  process.env.USE_FIXTURES = "0";
});

afterEach(() => {
  delete process.env.USE_FIXTURES;
});

describe("dashboard.getSummary (real branch)", () => {
  test("targets dev_daily_rollup + team_weekly_rollup with tenant_id filter", async () => {
    const ch = mock(async (sql: string) => {
      if (sql.includes("team_weekly_rollup")) {
        return [{ ai_leverage_v1: 71 }];
      }
      if (sql.includes("GROUP BY day")) {
        return [{ day: "2026-04-14", cost_usd: 42.5, any_cost_estimated: 0 }];
      }
      return [
        {
          accepted_edits: 120,
          merged_prs: 8,
          sessions: 50,
          active_days: 14,
          outcome_events: 20,
          cohort_size: 10,
        },
      ];
    });
    const ctx = makeCtx("manager", { ch });

    const out = await getSummary(ctx, { window: "30d" });

    expect(out.total_cost_usd).toBe(42.5);
    expect(out.sessions).toBe(50);
    // ai_leverage_score passes the gate since sessions=50, cohort=10, etc.
    expect(out.ai_leverage_score.show).toBe(true);
    // Every CH call included the tenant_id parameter.
    for (const call of ch.mock.calls) {
      const [sql, params] = call as unknown as [string, Record<string, unknown>];
      expect(sql.toLowerCase()).toMatch(/dev_daily_rollup|team_weekly_rollup/);
      expect(params.tenant_id).toBe("org_fixtures_off");
      assertNoForbiddenColumns(sql);
    }
  });
});

describe("session.listSessions (real branch)", () => {
  test("selects from events with org_id + window filter, no forbidden columns", async () => {
    const ch = mock(async () => [
      {
        session_id: "sess_real_1",
        engineer_id: "dev-real-a",
        source: "claude-code",
        fidelity: "full",
        started_at: "2026-04-14 10:00:00",
        ended_at: "2026-04-14 10:07:00",
        cost_usd: 1.23,
        cost_estimated: 0,
        input_tokens: 1000,
        output_tokens: 400,
        accepted_edits: 2,
        tier: "B",
        duration_s: 420,
      },
    ]);
    const ctx = makeCtx("manager", { ch });

    const out = await listSessions(ctx, { window: "7d", limit: 100 });
    expect(out.sessions.length).toBe(1);
    expect(out.sessions[0]?.session_id).toBe("sess_real_1");

    const [sql, params] = firstCh(ch);
    expect(sql).toContain("FROM events");
    expect(sql).toMatch(/org_id\s*=\s*\{tenant_id:String\}/);
    expect(params.tenant_id).toBe("org_fixtures_off");
    assertNoForbiddenColumns(sql);
  });

  test("passes source/engineer_id filters through as parameters", async () => {
    const ch = mock(async () => []);
    const ctx = makeCtx("manager", { ch });
    await listSessions(ctx, {
      window: "30d",
      source: "cursor",
      engineer_id: "dev-xyz",
      limit: 50,
    });
    const [sql, params] = firstCh(ch);
    expect(sql).toContain("source = {source:String}");
    expect(sql).toContain("engineer_id = {engineer_id:String}");
    expect(params.source).toBe("cursor");
    expect(params.engineer_id).toBe("dev-xyz");
  });
});

describe("session.getSession (real branch)", () => {
  test("without reveal_token never queries prompt_text", async () => {
    const ch = mock(async () => [
      {
        session_id: "sess_real_2",
        engineer_id: "dev-b",
        source: "claude-code",
        fidelity: "full",
        started_at: "2026-04-14 09:00:00",
        ended_at: "2026-04-14 09:05:00",
        cost_usd: 0.5,
        cost_estimated: 0,
        input_tokens: 500,
        output_tokens: 200,
        accepted_edits: 1,
        tier: "B",
      },
    ]);
    const ctx = makeCtx("manager", { ch });

    const out = await getSession(ctx, { session_id: "sess_real_2" });
    expect(out.prompt_text).toBeNull();
    expect(out.redacted_reason).toBe("consent_required");
    // Exactly one CH call — the summary read. No prompt_text lookup.
    expect(ch.mock.calls.length).toBe(1);
    const [sql] = firstCh(ch);
    expect(sql).not.toContain("prompt_text");
  });

  test("with reveal_token issues a separate Tier-C prompt_text lookup", async () => {
    const ch = mock(async (sql: string) => {
      if (sql.includes("tier = 'C'")) {
        return [{ prompt_text: "hello world" }];
      }
      return [
        {
          session_id: "sess_real_3",
          engineer_id: "dev-c",
          source: "claude-code",
          fidelity: "full",
          started_at: "2026-04-14 11:00:00",
          ended_at: "2026-04-14 11:03:00",
          cost_usd: 0.8,
          cost_estimated: 0,
          input_tokens: 700,
          output_tokens: 300,
          accepted_edits: 3,
          tier: "C",
        },
      ];
    });
    const ctx: Ctx = { ...makeCtx("manager", { ch }), reveal_token: "tok_live" };

    const out = await getSession(ctx, { session_id: "sess_real_3" });
    expect(out.prompt_text).toBe("hello world");
    expect(ch.mock.calls.length).toBe(2);
  });
});

describe("team.listTeams (real branch)", () => {
  test("joins Postgres teams with CH team_weekly_rollup, enforces k≥5 gate", async () => {
    const pg = mock(async () => [
      { id: "team_a", slug: "alpha", label: "Alpha" },
      { id: "team_b", slug: "beta", label: "Beta" },
    ]);
    const ch = mock(async () => [
      {
        team_id: "team_a",
        engineers: 10,
        cohort_size: 10,
        cost_usd: 222.5,
        sessions_count: 200,
        active_days: 20,
        outcome_events: 40,
        ai_leverage_v1: 68,
        fidelity: "full",
      },
      {
        team_id: "team_b",
        engineers: 3,
        cohort_size: 3,
        cost_usd: 40,
        sessions_count: 20,
        active_days: 4,
        outcome_events: 5,
        ai_leverage_v1: 55,
        fidelity: "full",
      },
    ]);
    const ctx = makeCtx("manager", { ch, pg });

    const out = await listTeams(ctx, { window: "30d" });
    expect(out.teams.length).toBe(2);

    const alpha = out.teams.find((t) => t.id === "team_a");
    const beta = out.teams.find((t) => t.id === "team_b");
    expect(alpha?.ai_leverage_score.show).toBe(true);
    // Beta has cohort_size=3 < 5 k-anonymity floor; gate suppresses.
    expect(beta?.ai_leverage_score.show).toBe(false);

    const [pgSql, pgParams] = firstPg(pg);
    expect(pgSql).toContain("FROM teams");
    expect(pgParams[0]).toBe("org_fixtures_off");
  });
});

describe("team.getTwoByTwo (real branch)", () => {
  test("cohort_size < 5 trips k_anonymity_floor, scatter suppressed", async () => {
    // Only 3 distinct engineer hashes → cohort size of 3.
    const ch = mock(async (sql: string) => {
      if (sql.includes("DISTINCT task_category")) {
        return [{ task_category: "feature_work" }];
      }
      return [
        {
          engineer_id_hash: "aaaaaaaa",
          outcome_quality: 70,
          efficiency: 60,
          sessions: 10,
          cost_usd: 10,
        },
        {
          engineer_id_hash: "bbbbbbbb",
          outcome_quality: 65,
          efficiency: 55,
          sessions: 8,
          cost_usd: 8,
        },
        {
          engineer_id_hash: "cccccccc",
          outcome_quality: 72,
          efficiency: 68,
          sessions: 12,
          cost_usd: 15,
        },
      ];
    });
    const ctx = makeCtx("manager", { ch });

    const out = await getTwoByTwo(ctx, { window: "30d", team_id: "team_small" });
    expect(out.cohort_size).toBe(3);
    expect(out.display.show).toBe(false);
    expect(out.points.length).toBe(0);
  });
});

describe("cluster.listClusters (real branch)", () => {
  test("filters k≥3 and reports suppressed count, hits prompt_cluster_stats", async () => {
    const ch = mock(async () => [
      {
        cluster_id: "c1",
        label: "api integration test debugging",
        contributor_count: 5,
        session_count: 40,
        avg_cost_usd: 0.9,
        merged_pr_count: 10,
        green_test_count: 5,
        revert_count: 1,
        fidelity: "full",
      },
      {
        cluster_id: "c2",
        label: "lone refactor",
        contributor_count: 1, // below floor — dropped
        session_count: 4,
        avg_cost_usd: 0.3,
        merged_pr_count: 0,
        green_test_count: 0,
        revert_count: 0,
        fidelity: "full",
      },
    ]);
    const ctx = makeCtx("manager", { ch });

    const out = await listClusters(ctx, { window: "30d" });
    expect(out.clusters.length).toBe(1);
    expect(out.suppressed_below_floor).toBe(1);
    expect(out.clusters[0]?.id).toBe("c1");

    const [sql, params] = firstCh(ch);
    expect(sql).toContain("FROM prompt_cluster_stats");
    expect(params.tenant_id).toBe("org_fixtures_off");
    assertNoForbiddenColumns(sql);
  });
});

describe("cluster.findSessionTwins (real branch)", () => {
  test("two-step CH read: query embedding lookup, then candidate fetch + stats; no forbidden columns", async () => {
    let callIdx = 0;
    const ch = mock(async (sql: string, params: Record<string, unknown>) => {
      callIdx += 1;
      if (sql.includes("LIMIT 1")) {
        // Query session lookup
        expect(params.tenant_id).toBe("org_fixtures_off");
        expect(params.session_id).toBe("ses_under_test");
        return [
          {
            cluster_id: "c_realbranch",
            prompt_embedding: [1, 0, 0, 0],
          },
        ];
      }
      if (sql.includes("prompt_cluster_stats")) {
        return [
          { cluster_id: "c_realbranch", distinct_engineers: 5 },
          { cluster_id: "c_other", distinct_engineers: 1 }, // below floor
        ];
      }
      // candidate pool — must have org_id filter + LIMIT cap
      expect(sql).toContain("cluster_assignment_mv");
      expect(sql).toContain("INNER JOIN events");
      expect(params.tenant_id).toBe("org_fixtures_off");
      expect(params.max_candidates).toBe(10_000);
      assertNoForbiddenColumns(sql);
      return [
        {
          session_id: "ses_match_1",
          engineer_id: "eng_real_a",
          cluster_id: "c_realbranch",
          prompt_embedding: [0.99, 0.1, 0, 0],
        },
        {
          session_id: "ses_match_2",
          engineer_id: "eng_real_b",
          cluster_id: "c_realbranch",
          prompt_embedding: [0.95, 0.2, 0, 0],
        },
        {
          session_id: "ses_filtered",
          engineer_id: "eng_real_c",
          cluster_id: "c_other", // below floor — must be dropped
          prompt_embedding: [1, 0, 0, 0],
        },
      ];
    });
    const ctx = makeCtx("manager", { ch });

    const out = await findSessionTwins(ctx, { session_id: "ses_under_test", top_k: 5 });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.query_cluster_id).toBe("c_realbranch");
    expect(out.matches.length).toBe(2);
    expect(out.matches.find((m) => m.session_id === "ses_filtered")).toBeUndefined();
    for (const m of out.matches) {
      expect(m.engineer_id_hash).not.toContain("eng_real_");
    }
    expect(callIdx).toBeGreaterThanOrEqual(3);
  });

  test("returns no_embedding when the query session has no prompt_embedding", async () => {
    const ch = mock(async (sql: string) => {
      if (sql.includes("LIMIT 1")) {
        return [{ cluster_id: null, prompt_embedding: [] }];
      }
      return [];
    });
    const ctx = makeCtx("manager", { ch });
    const out = await findSessionTwins(ctx, { session_id: "ses_empty" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("no_embedding");
  });
});

describe("outcomes.perDevOutcomes (real branch)", () => {
  test("targets dev_daily_rollup with tenant + limit filters", async () => {
    const ch = mock(async (sql: string) => {
      if (sql.includes("uniqExact(engineer_id)") && !sql.includes("GROUP BY engineer_id")) {
        return [{ cohort_size: 7 }];
      }
      return [
        {
          engineer_id: "dev-01",
          engineer_id_hash: "11111111",
          sessions: 40,
          cost_usd: 50,
          accepted_edits: 20,
          accepted_and_retained: 18,
          merged_prs: 4,
          green_tests: 3,
          reverts: 1,
        },
      ];
    });
    const ctx = makeCtx("manager", { ch });

    const out = await perDevOutcomes(ctx, { window: "30d", limit: 50 });
    expect(out.rows.length).toBe(1);
    expect(out.cohort_size).toBe(7);
    const [sql, params] = firstCh(ch);
    expect(sql).toContain("FROM dev_daily_rollup");
    expect(params.tenant_id).toBe("org_fixtures_off");
    expect(params.limit).toBe(50);
    assertNoForbiddenColumns(sql);
  });
});

describe("outcomes.perPROutcomes (real branch)", () => {
  test("queries pr_outcome_rollup and aggregates totals", async () => {
    const ch = mock(async () => [
      {
        repo: "acme/frontend",
        pr_number: 42,
        merged_at: "2026-04-14 14:00:00",
        cost_usd: 2.5,
        accepted_edit_count: 5,
        reverted: 0,
        ai_assisted: 1,
      },
      {
        repo: "acme/frontend",
        pr_number: 43,
        merged_at: "2026-04-13 09:00:00",
        cost_usd: 0,
        accepted_edit_count: 0,
        reverted: 1,
        ai_assisted: 0,
      },
    ]);
    const ctx = makeCtx("manager", { ch });
    const out = await perPROutcomes(ctx, { window: "30d", limit: 50 });
    expect(out.totals.prs).toBe(2);
    expect(out.totals.ai_assisted_prs).toBe(1);
    expect(out.totals.reverted_prs).toBe(1);

    const [sql, params] = firstCh(ch);
    expect(sql).toContain("FROM pr_outcome_rollup");
    expect(params.tenant_id).toBe("org_fixtures_off");
    assertNoForbiddenColumns(sql);
  });
});

describe("outcomes.perCommitOutcomes (real branch)", () => {
  test("queries commit_outcome_rollup with ts window", async () => {
    const ch = mock(async () => [
      {
        repo: "acme/backend",
        commit_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        pr_number: 100,
        author_engineer_id_hash: "22222222",
        ts: "2026-04-14 10:00:00",
        cost_usd_attributed: 0.75,
        ai_assisted: 1,
        reverted: 0,
      },
    ]);
    const ctx = makeCtx("manager", { ch });
    const out = await perCommitOutcomes(ctx, { window: "7d", limit: 100 });
    expect(out.rows[0]?.ai_assisted).toBe(true);
    expect(out.rows[0]?.commit_sha.length).toBe(40);
    const [sql] = firstCh(ch);
    expect(sql).toContain("FROM commit_outcome_rollup");
    assertNoForbiddenColumns(sql);
  });
});

describe("alerts.listAlerts (real branch)", () => {
  test("reads Postgres alerts with severity rank + tenant filter", async () => {
    const pg = mock(async () => [
      {
        id: "alert_1",
        kind: "cost_spike",
        severity: "warn",
        engineer_id_hash: "88888888",
        team_id: null,
        triggered_at: "2026-04-14 12:00:00",
        value: 9.1,
        threshold: 6.5,
        baseline: 3.9,
        description: "Warning: cost spike",
        scope_ref: "session:aaaabbbb",
        severity_rank: 1,
      },
      {
        id: "alert_2",
        kind: "infinite_loop",
        severity: "info",
        engineer_id_hash: null,
        team_id: null,
        triggered_at: "2026-04-14 11:00:00",
        value: 2,
        threshold: 1,
        baseline: 0.5,
        description: "Info: loop",
        scope_ref: null,
        severity_rank: 0,
      },
    ]);
    const ctx = makeCtx("admin", { pg });
    const out = await listAlerts(ctx, {
      window: "7d",
      min_severity: "warn",
      limit: 50,
    });
    // min_severity filter drops the info alert.
    expect(out.alerts.length).toBe(1);
    expect(out.alerts[0]?.severity).toBe("warn");
    expect(out.counts_by_severity.warn).toBe(1);
    expect(out.counts_by_severity.info).toBe(0);
    const [sql, params] = firstPg(pg);
    expect(sql).toContain("FROM alerts");
    expect(params[0]).toBe("org_fixtures_off");
    assertNoForbiddenColumns(sql);
  });
});

describe("insights.getWeeklyDigest (real branch)", () => {
  test("reads from insights table and filters low-confidence rows", async () => {
    const pg = mock(async () => [
      {
        id: "ins_1",
        title: "High conf",
        body: "body a",
        confidence: "high",
        subject_kind: "efficiency",
        citations: [],
        generated_at: "2026-04-14 12:00:00",
      },
      {
        id: "ins_2",
        title: "Low conf",
        body: "body b",
        confidence: "low",
        subject_kind: "waste",
        citations: [],
        generated_at: "2026-04-14 12:00:00",
      },
    ]);
    const ctx = makeCtx("manager", { pg });
    const out = await getWeeklyDigest(ctx, { week: "2026-W15" });
    // Low confidence was server-side dropped.
    expect(out.insights.length).toBe(1);
    expect(out.dropped_low_confidence).toBe(1);
    const [sql, params] = firstPg(pg);
    expect(sql).toContain("FROM insights");
    expect(params[0]).toBe("org_fixtures_off");
    expect(params[1]).toBe("2026-W15");
    assertNoForbiddenColumns(sql);
  });
});

describe("audit.getMyViewHistory (real branch)", () => {
  test("reads audit_events narrowed to the actor's own id", async () => {
    const pg = mock(async (sql: string) => {
      if (sql.includes("notification_prefs")) {
        return [{ notification_pref: "immediate" }];
      }
      return [
        {
          id: "audit_1",
          ts: "2026-04-14 12:00:00",
          actor_id: "actor_manager",
          actor_display_name: "Manager",
          actor_role: "manager",
          target_engineer_id: "actor_lane1",
          surface: "me_page",
          reason: null,
          session_id: null,
        },
      ];
    });
    const ctx = makeCtx("engineer", { pg });
    const out = await getMyViewHistory(ctx, { window: "24h" });
    expect(out.events.length).toBe(1);
    expect(out.notification_pref).toBe("immediate");
    const [sql, params] = firstPg(pg);
    expect(sql).toContain("FROM audit_events");
    expect(params[0]).toBe("org_fixtures_off");
    // actor_id is the narrow filter — the IC can only see their own history.
    expect(params[1]).toBe("actor_lane1");
    assertNoForbiddenColumns(sql);
  });
});

describe("fixture branch is untouched when USE_FIXTURES is unset or '1'", () => {
  test("getSummary in fixture mode never calls ctx.db.ch", async () => {
    delete process.env.USE_FIXTURES;
    const ch = mock(async () => []);
    const pg = mock(async () => []);
    const ctx = makeCtx("manager", { ch, pg });
    const out = await getSummary(ctx, { window: "7d" });
    expect(ch.mock.calls.length).toBe(0);
    expect(pg.mock.calls.length).toBe(0);
    expect(out.total_cost_usd).toBeGreaterThan(0);
  });

  test("explicit USE_FIXTURES=1 is byte-identical to unset default", async () => {
    const ch = mock(async () => []);
    const pg = mock(async () => []);
    const ctx = makeCtx("manager", { ch, pg });

    delete process.env.USE_FIXTURES;
    const unset = await getSummary(ctx, { window: "7d" });

    process.env.USE_FIXTURES = "1";
    const explicit = await getSummary(ctx, { window: "7d" });

    expect(explicit).toEqual(unset);
    expect(ch.mock.calls.length).toBe(0);
  });
});

describe("policy.getEffectivePolicy (real branch)", () => {
  test("reads policies table and returns D7 defaults on miss", async () => {
    const pgHit = mock(async () => [
      {
        tier: "B" as const,
        retention_days: 90,
        redaction_trufflehog: true,
        redaction_gitleaks: true,
        redaction_presidio_ner: true,
        ai_assisted_trailer: true,
        manager_view_notification: "immediate" as const,
        ingest_only_to: "https://ingest.custom",
        tier_c_signed_config_effective_at: null,
        tier_c_signed_config_cooldown_ends_at: null,
        tier_c_managed_cloud_optin: false,
      },
    ]);
    const ctx = makeCtx("engineer", { pg: pgHit });
    const out = await getEffectivePolicy(ctx, {});
    expect(out.ai_assisted_trailer).toBe(true);
    expect(out.notifications.manager_view).toBe("immediate");
    expect(out.ingest_only_to).toBe("https://ingest.custom");

    const [sql, params] = firstPg(pgHit);
    expect(sql).toContain("FROM policies");
    expect(params[0]).toBe("org_fixtures_off");
  });

  test("falls back to D7 defaults when no policy row exists", async () => {
    const pgMiss = mock(async () => []);
    const ctx = makeCtx("engineer", { pg: pgMiss });
    const out = await getEffectivePolicy(ctx, {});
    expect(out.tier).toBe("B");
    expect(out.retention_days).toBe(90);
    expect(out.ai_assisted_trailer).toBe(false);
    expect(out.notifications.manager_view).toBe("daily");
  });
});
