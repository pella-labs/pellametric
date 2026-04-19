// Unit tests for `computeLinkerState` + `resolveEligibility`.
// Pure-function tests, zero I/O — one per input-dimension + eligibility modes.

import { describe, expect, test } from "bun:test";
import { assertEvidenceSafe, computeLinkerState, type LinkerInputs } from "./state";

const SHA = (n: number): string => n.toString(16).padStart(40, "0");
const UUID = (n: number): string => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const CLOCK = { now: () => "2026-04-18T12:00:00.000Z" };
const HASH = (tag: string): Buffer => {
  const b = Buffer.alloc(32);
  Buffer.from(tag).copy(b);
  return b;
};

function baseInputs(overrides: Partial<LinkerInputs> = {}): LinkerInputs {
  return {
    tenant_id: UUID(1),
    tenant_mode: "all",
    installations: [{ installation_id: "inst-1", status: "active" }],
    repos: [{ provider_repo_id: "r1", tracking_state: "inherit" }],
    session: {
      session_id: UUID(2),
      direct_provider_repo_ids: ["r1"],
      commit_shas: [],
      pr_numbers: [],
    },
    pull_requests: [],
    deployments: [],
    aliases: [],
    tombstones: [],
    ...overrides,
  };
}

describe("computeLinkerState — per-input-dimension", () => {
  test("empty inputs → no links, ineligible, branch_only_session=true", () => {
    const inp = baseInputs({
      session: {
        session_id: UUID(2),
        direct_provider_repo_ids: [],
        commit_shas: [],
        pr_numbers: [],
      },
      repos: [],
    });
    const out = computeLinkerState(inp, CLOCK);
    expect(out.links).toHaveLength(0);
    expect(out.eligibility.eligible).toBe(false);
    expect(out.eligibility.eligibility_reasons).toMatchObject({ branch_only_session: true });
  });

  test("direct_repo only → 1 link, eligible under mode=all", () => {
    const out = computeLinkerState(baseInputs(), CLOCK);
    expect(out.links).toHaveLength(1);
    expect(out.links[0]?.match_reason).toBe("direct_repo");
    expect(out.eligibility.eligible).toBe(true);
  });

  test("commit_link only via PR head_sha", () => {
    const inp = baseInputs({
      session: {
        session_id: UUID(2),
        direct_provider_repo_ids: [],
        commit_shas: [SHA(1)],
        pr_numbers: [],
      },
      pull_requests: [
        {
          provider_repo_id: "r1",
          pr_number: 10,
          head_sha: SHA(1),
          merge_commit_sha: null,
          state: "open",
          from_fork: false,
          title_hash: HASH("t"),
          author_login_hash: HASH("a"),
          additions: 0,
          deletions: 0,
          changed_files: 0,
        },
      ],
    });
    const out = computeLinkerState(inp, CLOCK);
    expect(out.links).toHaveLength(1);
    expect(out.links[0]?.match_reason).toBe("commit_link");
  });

  test("pr_link produces separate row from commit_link for same PR", () => {
    const inp = baseInputs({
      session: {
        session_id: UUID(2),
        direct_provider_repo_ids: [],
        commit_shas: [SHA(1)],
        pr_numbers: [10],
      },
      pull_requests: [
        {
          provider_repo_id: "r1",
          pr_number: 10,
          head_sha: SHA(1),
          merge_commit_sha: null,
          state: "open",
          from_fork: false,
          title_hash: HASH("t"),
          author_login_hash: HASH("a"),
          additions: 0,
          deletions: 0,
          changed_files: 0,
        },
      ],
    });
    const out = computeLinkerState(inp, CLOCK);
    const reasons = out.links.map((l) => l.match_reason).sort();
    expect(reasons).toEqual(["commit_link", "pr_link"]);
  });

  test("deployment_link on sha intersection", () => {
    const inp = baseInputs({
      session: {
        session_id: UUID(2),
        direct_provider_repo_ids: [],
        commit_shas: [SHA(9)],
        pr_numbers: [],
      },
      deployments: [
        {
          provider_repo_id: "r1",
          deployment_id: "d-1",
          sha: SHA(9),
          environment: "prod",
          status: "success",
        },
      ],
    });
    const out = computeLinkerState(inp, CLOCK);
    expect(out.links).toHaveLength(1);
    expect(out.links[0]?.match_reason).toBe("deployment_link");
  });

  test("force-push tombstone excludes SHA from commit_link", () => {
    const inp = baseInputs({
      session: {
        session_id: UUID(2),
        direct_provider_repo_ids: [],
        commit_shas: [SHA(5)],
        pr_numbers: [],
      },
      pull_requests: [
        {
          provider_repo_id: "r1",
          pr_number: 1,
          head_sha: SHA(5),
          merge_commit_sha: null,
          state: "open",
          from_fork: false,
          title_hash: HASH("t"),
          author_login_hash: HASH("a"),
          additions: 0,
          deletions: 0,
          changed_files: 0,
        },
      ],
      tombstones: [{ provider_repo_id: "r1", excluded_shas: [SHA(5)] }],
    });
    const out = computeLinkerState(inp, CLOCK);
    expect(out.links).toHaveLength(0);
    expect(out.eligibility.eligible).toBe(false);
  });

  test("installation suspend → links flagged stale_at", () => {
    const inp = baseInputs({ installation_status: "suspended" });
    const out = computeLinkerState(inp, CLOCK);
    expect(out.links).toHaveLength(1);
    expect(out.links[0]?.stale_at).not.toBeNull();
  });

  test("unknown repo is ignored even when PR matches SHA", () => {
    const inp = baseInputs({
      repos: [{ provider_repo_id: "r1", tracking_state: "inherit" }],
      session: {
        session_id: UUID(2),
        direct_provider_repo_ids: [],
        commit_shas: [SHA(7)],
        pr_numbers: [],
      },
      pull_requests: [
        {
          provider_repo_id: "unknown",
          pr_number: 1,
          head_sha: SHA(7),
          merge_commit_sha: null,
          state: "open",
          from_fork: false,
          title_hash: HASH("t"),
          author_login_hash: HASH("a"),
          additions: 0,
          deletions: 0,
          changed_files: 0,
        },
      ],
    });
    const out = computeLinkerState(inp, CLOCK);
    expect(out.links).toHaveLength(0);
  });
});

describe("resolveEligibility — PRD §13 3 modes + branch-only", () => {
  test("mode=all: inherit resolves to included → eligible", () => {
    const inp = baseInputs({ tenant_mode: "all" });
    const out = computeLinkerState(inp, CLOCK);
    expect(out.eligibility.eligible).toBe(true);
    expect(out.eligibility.eligibility_reasons).toMatchObject({ mode: "all" });
  });

  test("mode=all: explicitly excluded repo → not eligible", () => {
    const inp = baseInputs({
      tenant_mode: "all",
      repos: [{ provider_repo_id: "r1", tracking_state: "excluded" }],
    });
    const out = computeLinkerState(inp, CLOCK);
    expect(out.eligibility.eligible).toBe(false);
  });

  test("mode=selected: inherit → excluded → not eligible", () => {
    const inp = baseInputs({
      tenant_mode: "selected",
      repos: [{ provider_repo_id: "r1", tracking_state: "inherit" }],
    });
    const out = computeLinkerState(inp, CLOCK);
    expect(out.eligibility.eligible).toBe(false);
  });

  test("mode=selected: tracking_state='included' → eligible", () => {
    const inp = baseInputs({
      tenant_mode: "selected",
      repos: [{ provider_repo_id: "r1", tracking_state: "included" }],
    });
    const out = computeLinkerState(inp, CLOCK);
    expect(out.eligibility.eligible).toBe(true);
  });

  test("branch-only session (no overlap) → ineligible", () => {
    const inp = baseInputs({
      session: {
        session_id: UUID(2),
        direct_provider_repo_ids: [],
        commit_shas: [],
        pr_numbers: [],
      },
    });
    const out = computeLinkerState(inp, CLOCK);
    expect(out.eligibility.eligible).toBe(false);
    expect(out.eligibility.eligibility_reasons).toMatchObject({ branch_only_session: true });
  });
});

describe("assertEvidenceSafe — D57 forbidden-field gate", () => {
  test("safe evidence passes", () => {
    expect(() =>
      assertEvidenceSafe({ pr_number: 1, title_hash_hex: "ab", matched_sha_count: 1 }),
    ).not.toThrow();
  });
  test("raw title field rejected", () => {
    expect(() => assertEvidenceSafe({ title: "fix the bug" })).toThrow(/FORBIDDEN_FIELD/);
  });
  test("raw login field rejected", () => {
    expect(() => assertEvidenceSafe({ login: "octocat" })).toThrow(/FORBIDDEN_FIELD/);
  });
  test("title_hash_hex allowed when value is 64-hex", () => {
    expect(() => assertEvidenceSafe({ title_hash_hex: "a".repeat(64) })).not.toThrow();
  });
  test("overly long string rejected (even on an allowlisted key)", () => {
    const long = "a".repeat(257);
    expect(() => assertEvidenceSafe({ environment: long })).toThrow(/exceeds 256-char budget/);
  });
});

describe("assertEvidenceSafe — B10 recursive allowlist", () => {
  // Known-safe shapes produced by computeLinkerState; tightening the
  // validator must NOT reject them.
  test("accepts direct_repo evidence", () => {
    expect(() => assertEvidenceSafe({ source: "direct_repo" })).not.toThrow();
  });
  test("accepts pr_commit_intersection evidence", () => {
    expect(() =>
      assertEvidenceSafe({
        source: "pr_commit_intersection",
        pr_number: 42,
        matched_sha_count: 2,
        title_hash_hex: "a".repeat(64),
        author_login_hash_hex: "b".repeat(64),
      }),
    ).not.toThrow();
  });
  test("accepts session_pr_number evidence", () => {
    expect(() =>
      assertEvidenceSafe({
        source: "session_pr_number",
        pr_number: 7,
        state: "merged",
        from_fork: false,
        additions: 120,
        deletions: 18,
        changed_files: 4,
      }),
    ).not.toThrow();
  });
  test("accepts deployment_sha_intersection evidence", () => {
    expect(() =>
      assertEvidenceSafe({
        source: "deployment_sha_intersection",
        deployment_id: "1234567890",
        environment: "production",
        status: "success",
      }),
    ).not.toThrow();
  });

  // Attack vectors the shallow top-level regex denylist misses.
  test("rejects nested branch_name (deeply buried raw string)", () => {
    expect(() =>
      assertEvidenceSafe({
        source: "pr_commit_intersection",
        extra: { branch_name: "feature/acq-sensitive" },
      }),
    ).toThrow(/FORBIDDEN_FIELD/);
  });
  test("rejects top-level summary (PR body content)", () => {
    expect(() => assertEvidenceSafe({ summary: "raw PR body" })).toThrow(/FORBIDDEN_FIELD/);
  });
  test("rejects title_hash value that is not a 64-hex sha256", () => {
    expect(() => assertEvidenceSafe({ title_hash: "not-actually-a-hash" })).toThrow(
      /FORBIDDEN_FIELD|FORBIDDEN_STRING/,
    );
  });
  test("rejects nested object with forbidden key even in arrays", () => {
    expect(() =>
      assertEvidenceSafe({
        prs: [{ pr_number: 1, login: "octocat" }],
      }),
    ).toThrow(/FORBIDDEN_FIELD/);
  });
  test("rejects raw string value in otherwise-allowed key", () => {
    // `environment` is an allowed key, but the value must be a short
    // structural token — a 200-char essay smuggled through must fail.
    const essay = "a b c d e f ".repeat(40);
    expect(() => assertEvidenceSafe({ environment: essay })).toThrow(
      /FORBIDDEN_STRING|exceeds 256-char budget/,
    );
  });
  test("rejects unknown top-level key even if value is harmless", () => {
    expect(() => assertEvidenceSafe({ secret_metric_value: 42 })).toThrow(/FORBIDDEN_FIELD/);
  });
});
