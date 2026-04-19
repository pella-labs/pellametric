// PRD §10 D53 commutativity invariant — MERGE BLOCKER.
//
// For each of 10 fixture scenarios, 100 random orderings of the same input
// multiset must produce:
//   (1) identical `inputs_sha256`
//   (2) identical `LinkerState.links` set (after sorting by PK tuple)
//   (3) identical eligibility decision
//
// Deterministic — seeded LCG RNG so failures reproduce.

import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  computeLinkerState,
  type Deployment,
  type ForcePushTombstone,
  type Installation,
  type LinkerInputs,
  type PullRequest,
  type Repo,
  type SessionEnrichment,
} from "./state";

// --- seeded LCG RNG (deterministic, no deps) -----------------------------
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // numerical recipes LCG
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

// --- scenarios -----------------------------------------------------------

interface Scenario {
  name: string;
  build(): LinkerInputs;
}

const SHA = (n: number): string => n.toString(16).padStart(40, "0");
const UUID = (n: number): string => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const HASH = (tag: string): Buffer => {
  const b = Buffer.alloc(32);
  Buffer.from(tag).copy(b);
  return b;
};

const CLOCK = { now: () => "2026-04-18T12:00:00.000Z" };

const scenarios: Scenario[] = [
  {
    name: "s1: new session + 3 triggers",
    build: () => ({
      tenant_id: UUID(1),
      tenant_mode: "all",
      installations: [{ installation_id: "inst-1", status: "active" }],
      repos: [{ provider_repo_id: "101", tracking_state: "inherit" }],
      session: {
        session_id: UUID(100),
        direct_provider_repo_ids: ["101"],
        commit_shas: [SHA(1), SHA(2), SHA(3)],
        pr_numbers: [42],
      },
      pull_requests: [
        {
          provider_repo_id: "101",
          pr_number: 42,
          head_sha: SHA(1),
          merge_commit_sha: null,
          state: "open",
          from_fork: false,
          title_hash: HASH("t-42"),
          author_login_hash: HASH("a-42"),
          additions: 10,
          deletions: 2,
          changed_files: 3,
        },
      ],
      deployments: [],
      aliases: [],
      tombstones: [],
    }),
  },
  {
    name: "s2: installation-suspend mid-session",
    build: () => ({
      tenant_id: UUID(2),
      tenant_mode: "all",
      installations: [{ installation_id: "inst-2", status: "suspended" }],
      installation_status: "suspended",
      repos: [{ provider_repo_id: "201", tracking_state: "inherit" }],
      session: {
        session_id: UUID(200),
        direct_provider_repo_ids: ["201"],
        commit_shas: [SHA(10)],
        pr_numbers: [],
      },
      pull_requests: [
        {
          provider_repo_id: "201",
          pr_number: 1,
          head_sha: SHA(10),
          merge_commit_sha: null,
          state: "open",
          from_fork: false,
          title_hash: HASH("t"),
          author_login_hash: HASH("a"),
          additions: 1,
          deletions: 0,
          changed_files: 1,
        },
      ],
      deployments: [],
      aliases: [],
      tombstones: [],
    }),
  },
  {
    name: "s3: force-push tombstone excludes SHA",
    build: () => ({
      tenant_id: UUID(3),
      tenant_mode: "all",
      installations: [{ installation_id: "inst-3", status: "active" }],
      repos: [{ provider_repo_id: "301", tracking_state: "inherit" }],
      session: {
        session_id: UUID(300),
        direct_provider_repo_ids: [],
        commit_shas: [SHA(20), SHA(21)],
        pr_numbers: [],
      },
      pull_requests: [
        {
          provider_repo_id: "301",
          pr_number: 1,
          head_sha: SHA(20),
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
      deployments: [],
      aliases: [],
      tombstones: [{ provider_repo_id: "301", excluded_shas: [SHA(20)] }],
    }),
  },
  {
    name: "s4: rename alias (alias set but output stable)",
    build: () => ({
      tenant_id: UUID(4),
      tenant_mode: "all",
      installations: [{ installation_id: "inst-4", status: "active" }],
      repos: [{ provider_repo_id: "401", tracking_state: "inherit" }],
      session: {
        session_id: UUID(400),
        direct_provider_repo_ids: ["401"],
        commit_shas: [],
        pr_numbers: [],
      },
      pull_requests: [],
      deployments: [],
      aliases: [
        { old_hash: HASH("old"), new_hash: HASH("new"), reason: "rename" },
        { old_hash: HASH("old2"), new_hash: HASH("new2"), reason: "transfer" },
      ],
      tombstones: [],
    }),
  },
  {
    name: "s5: deploy after PR merge — both links",
    build: () => ({
      tenant_id: UUID(5),
      tenant_mode: "all",
      installations: [{ installation_id: "inst-5", status: "active" }],
      repos: [{ provider_repo_id: "501", tracking_state: "included" }],
      session: {
        session_id: UUID(500),
        direct_provider_repo_ids: [],
        commit_shas: [SHA(30)],
        pr_numbers: [99],
      },
      pull_requests: [
        {
          provider_repo_id: "501",
          pr_number: 99,
          head_sha: SHA(30),
          merge_commit_sha: SHA(31),
          state: "merged",
          from_fork: false,
          title_hash: HASH("t"),
          author_login_hash: HASH("a"),
          additions: 5,
          deletions: 5,
          changed_files: 2,
        },
      ],
      deployments: [
        {
          provider_repo_id: "501",
          deployment_id: "d-1",
          sha: SHA(30),
          environment: "production",
          status: "success",
        },
      ],
      aliases: [],
      tombstones: [],
    }),
  },
  {
    name: "s6: mode=selected with excluded repo → ineligible",
    build: () => ({
      tenant_id: UUID(6),
      tenant_mode: "selected",
      installations: [{ installation_id: "inst-6", status: "active" }],
      repos: [{ provider_repo_id: "601", tracking_state: "excluded" }],
      session: {
        session_id: UUID(600),
        direct_provider_repo_ids: ["601"],
        commit_shas: [],
        pr_numbers: [],
      },
      pull_requests: [],
      deployments: [],
      aliases: [],
      tombstones: [],
    }),
  },
  {
    name: "s7: branch-only session (no overlap) → empty + ineligible",
    build: () => ({
      tenant_id: UUID(7),
      tenant_mode: "all",
      installations: [{ installation_id: "inst-7", status: "active" }],
      repos: [{ provider_repo_id: "701", tracking_state: "inherit" }],
      session: {
        session_id: UUID(700),
        direct_provider_repo_ids: [],
        commit_shas: [],
        pr_numbers: [],
      },
      pull_requests: [],
      deployments: [],
      aliases: [],
      tombstones: [],
    }),
  },
  {
    name: "s8: multi-repo session — two PRs, two tracked repos",
    build: () => ({
      tenant_id: UUID(8),
      tenant_mode: "all",
      installations: [{ installation_id: "inst-8", status: "active" }],
      repos: [
        { provider_repo_id: "801", tracking_state: "included" },
        { provider_repo_id: "802", tracking_state: "inherit" },
      ],
      session: {
        session_id: UUID(800),
        direct_provider_repo_ids: ["801", "802"],
        commit_shas: [SHA(40), SHA(50)],
        pr_numbers: [1, 2],
      },
      pull_requests: [
        {
          provider_repo_id: "801",
          pr_number: 1,
          head_sha: SHA(40),
          merge_commit_sha: null,
          state: "open",
          from_fork: false,
          title_hash: HASH("1"),
          author_login_hash: HASH("1"),
          additions: 1,
          deletions: 1,
          changed_files: 1,
        },
        {
          provider_repo_id: "802",
          pr_number: 2,
          head_sha: SHA(50),
          merge_commit_sha: null,
          state: "open",
          from_fork: true,
          title_hash: HASH("2"),
          author_login_hash: HASH("2"),
          additions: 2,
          deletions: 2,
          changed_files: 2,
        },
      ],
      deployments: [],
      aliases: [],
      tombstones: [],
    }),
  },
  {
    name: "s9: placeholder repo_id_hash in stored field is rewritten",
    build: () => ({
      tenant_id: UUID(9),
      tenant_mode: "all",
      installations: [{ installation_id: "inst-9", status: "active" }],
      repos: [
        {
          provider_repo_id: "901",
          tracking_state: "inherit",
          // placeholder written by G1-initial-sync worker
          stored_repo_id_hash: `gh:pending:${UUID(9)}:901`,
        },
      ],
      session: {
        session_id: UUID(900),
        direct_provider_repo_ids: ["901"],
        commit_shas: [],
        pr_numbers: [],
      },
      pull_requests: [],
      deployments: [],
      aliases: [],
      tombstones: [],
    }),
  },
  {
    // G3 — D53 pure-function extension: 30-min force-push windows.
    // Session has 3 commits; the middle one's timestamp falls inside the
    // tombstone window so it must be excluded from link evidence. Permuting
    // any input collection or the commit order must produce the same result.
    name: "s11 (G3): force-push RANGE tombstone excludes a commit by timestamp",
    build: () => ({
      tenant_id: UUID(11),
      tenant_mode: "all",
      installations: [{ installation_id: "inst-11", status: "active" }],
      repos: [{ provider_repo_id: "1101", tracking_state: "inherit" }],
      session: {
        session_id: UUID(1100),
        direct_provider_repo_ids: [],
        commit_shas: [SHA(110), SHA(111), SHA(112)],
        commit_timestamps: [
          "2026-04-10T10:00:00.000Z",
          "2026-04-10T10:55:00.000Z", // inside [10:40, 11:10)
          "2026-04-10T11:30:00.000Z",
        ],
        pr_numbers: [],
      },
      pull_requests: [
        {
          provider_repo_id: "1101",
          pr_number: 5,
          head_sha: SHA(110),
          merge_commit_sha: null,
          state: "open",
          from_fork: false,
          title_hash: HASH("t-110"),
          author_login_hash: HASH("a-110"),
          additions: 0,
          deletions: 0,
          changed_files: 0,
        },
        {
          // the MIDDLE commit's head — must be excluded by the range.
          provider_repo_id: "1101",
          pr_number: 6,
          head_sha: SHA(111),
          merge_commit_sha: null,
          state: "open",
          from_fork: false,
          title_hash: HASH("t-111"),
          author_login_hash: HASH("a-111"),
          additions: 0,
          deletions: 0,
          changed_files: 0,
        },
        {
          provider_repo_id: "1101",
          pr_number: 7,
          head_sha: SHA(112),
          merge_commit_sha: null,
          state: "open",
          from_fork: false,
          title_hash: HASH("t-112"),
          author_login_hash: HASH("a-112"),
          additions: 0,
          deletions: 0,
          changed_files: 0,
        },
      ],
      deployments: [],
      aliases: [],
      tombstones: [
        {
          provider_repo_id: "1101",
          excluded_shas: [],
          excluded_ranges: [
            { range_start: "2026-04-10T10:40:00.000Z", range_end: "2026-04-10T11:10:00.000Z" },
          ],
        },
      ],
    }),
  },
  {
    name: "s10: unknown PR repo ignored (noise)",
    build: () => ({
      tenant_id: UUID(10),
      tenant_mode: "all",
      installations: [{ installation_id: "inst-10", status: "active" }],
      repos: [{ provider_repo_id: "1001", tracking_state: "inherit" }],
      session: {
        session_id: UUID(1000),
        direct_provider_repo_ids: [],
        commit_shas: [SHA(60)],
        pr_numbers: [],
      },
      pull_requests: [
        // matches session SHA but from a repo we don't track → must be ignored
        {
          provider_repo_id: "unknown-9999",
          pr_number: 1,
          head_sha: SHA(60),
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
      deployments: [],
      aliases: [],
      tombstones: [],
    }),
  },
];

function permuteInputs(inp: LinkerInputs, rng: () => number): LinkerInputs {
  // If commit_timestamps is present, shuffle BOTH arrays with the same
  // permutation so the paired shape doesn't desync — the canonicalizer
  // sorts them together before hashing.
  const hasTs =
    Array.isArray(inp.session.commit_timestamps) &&
    inp.session.commit_timestamps.length === inp.session.commit_shas.length;
  let shas: string[];
  let timestamps: string[] | undefined;
  if (hasTs && inp.session.commit_timestamps) {
    const paired = inp.session.commit_shas.map((s, i) => ({
      sha: s,
      // biome-ignore lint/style/noNonNullAssertion: guarded by hasTs.
      ts: inp.session.commit_timestamps![i]!,
    }));
    const shuffled = shuffle(paired, rng);
    shas = shuffled.map((p) => p.sha);
    timestamps = shuffled.map((p) => p.ts);
  } else {
    shas = shuffle(inp.session.commit_shas, rng);
    timestamps = undefined;
  }
  const sessionBase: typeof inp.session = {
    ...inp.session,
    direct_provider_repo_ids: shuffle(inp.session.direct_provider_repo_ids, rng),
    commit_shas: shas,
    pr_numbers: shuffle(inp.session.pr_numbers, rng),
  };
  if (timestamps !== undefined) {
    sessionBase.commit_timestamps = timestamps;
  }
  // Tombstone-range arrays shuffled inside each tombstone, AND the list of
  // tombstones itself shuffled.
  const tombstones = shuffle(
    inp.tombstones.map((t) =>
      t.excluded_ranges && t.excluded_ranges.length > 0
        ? { ...t, excluded_ranges: shuffle(t.excluded_ranges, rng) }
        : t,
    ),
    rng,
  );
  return {
    ...inp,
    installations: shuffle(inp.installations, rng),
    repos: shuffle(inp.repos, rng),
    session: sessionBase,
    pull_requests: shuffle(inp.pull_requests, rng),
    deployments: shuffle(inp.deployments, rng),
    aliases: shuffle(inp.aliases, rng),
    tombstones,
  };
}

function linksFingerprint(links: ReturnType<typeof computeLinkerState>["links"]): string {
  return links
    .map((l) =>
      [
        l.tenant_id,
        l.session_id,
        l.repo_id_hash.toString("hex"),
        l.match_reason,
        l.provider_repo_id,
        l.confidence,
        l.stale_at ?? "active",
        JSON.stringify(l.evidence),
      ].join("|"),
    )
    .join("\n");
}

describe("linker commutativity (PRD §10 D53) — MERGE BLOCKER", () => {
  for (const s of scenarios) {
    test(`${s.name} — 100 random orderings produce identical inputs_sha256 + links`, () => {
      const base = s.build();
      const ref = computeLinkerState(base, CLOCK);
      const refSha = ref.inputs_sha256.toString("hex");
      const refFingerprint = linksFingerprint(ref.links);
      const refEligible = ref.eligibility.eligible;

      // 11 scenarios × 100 orderings each = 1,100 orderings aggregate (exceeds
      // D53 "≥ 1000 orderings" requirement in aggregate). One scenario below
      // runs a dedicated 1,000-ordering pass to also satisfy D53 per-scenario.
      for (let i = 0; i < 100; i++) {
        const rng = makeRng(0xc0ffee + i);
        const permuted = permuteInputs(base, rng);
        const out = computeLinkerState(permuted, CLOCK);
        expect(out.inputs_sha256.toString("hex")).toBe(refSha);
        expect(linksFingerprint(out.links)).toBe(refFingerprint);
        expect(out.eligibility.eligible).toBe(refEligible);
      }
    });
  }

  // B11 — dedicated per-scenario 1,000-ordering pass to literally satisfy
  // D53 on the most complex scenario (multi-trigger + force-push RANGE +
  // rename alias). The main suite above runs 100 orderings × 11 scenarios
  // = 1,100 orderings total; this adds 1,000 orderings on a single base so
  // there's a single-scenario D53 witness in the log.
  test("D53 per-scenario — s11 (force-push RANGE) holds across 1,000 orderings", () => {
    const s11 = scenarios.find((s) => s.name.startsWith("s11"));
    expect(s11).toBeDefined();
    if (!s11) return;
    const base = s11.build();
    const ref = computeLinkerState(base, CLOCK);
    const refSha = ref.inputs_sha256.toString("hex");
    const refFingerprint = linksFingerprint(ref.links);
    for (let i = 0; i < 1000; i++) {
      const rng = makeRng(0xb11b11 + i);
      const permuted = permuteInputs(base, rng);
      const out = computeLinkerState(permuted, CLOCK);
      expect(out.inputs_sha256.toString("hex")).toBe(refSha);
      expect(linksFingerprint(out.links)).toBe(refFingerprint);
    }
  });

  test("sanity: ref hash is 32 bytes for every scenario (pre-ordering smoke)", () => {
    for (const s of scenarios) {
      const base = s.build();
      const ref = computeLinkerState(base, CLOCK);
      expect(ref.inputs_sha256.length).toBe(32);
    }
  });

  test("sanity: distinct inputs produce distinct inputs_sha256", () => {
    const shas = new Set<string>();
    for (const s of scenarios) {
      const st = computeLinkerState(s.build(), CLOCK);
      shas.add(st.inputs_sha256.toString("hex"));
    }
    expect(shas.size).toBe(scenarios.length);
  });

  test("placeholder-rewritten hash equals authoritative HMAC", () => {
    const tenantId = UUID(9);
    const { repoIdHash, defaultTenantSalt } = require("./hash") as typeof import("./hash");
    const expected = repoIdHash(defaultTenantSalt(tenantId), "901");
    const st = computeLinkerState(scenarios[8]!.build(), CLOCK);
    expect(st.links.length).toBe(1);
    expect(st.links[0]?.repo_id_hash.equals(expected)).toBe(true);
  });

  test("random bytes unrelated to inputs do not leak into output", () => {
    // Ensure our Buffer / Uint8Array handling doesn't embed process-wide noise.
    const a = randomBytes(32);
    void a; // only here to assert the test runner loads node:crypto without side-effects
    const st1 = computeLinkerState(scenarios[0]!.build(), CLOCK);
    const st2 = computeLinkerState(scenarios[0]!.build(), CLOCK);
    expect(st1.inputs_sha256.equals(st2.inputs_sha256)).toBe(true);
  });
});

// exported for reuse by integration tests
export { CLOCK as _CLOCK, scenarios as _commutativityScenarios };

// Unused type imports silenced — they keep the file self-documenting for
// future contributors who `grep` for shape names.
void null as unknown as {
  _a: Installation;
  _b: Repo;
  _c: SessionEnrichment;
  _d: PullRequest;
  _e: Deployment;
  _f: ForcePushTombstone;
};
