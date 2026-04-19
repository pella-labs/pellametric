// G3 — force-push tombstone RANGE eligibility exclusion (PRD §13 Phase G3).
//
// Exercises the D53 pure-function extension that adds 30-min windows on top
// of the G1 SHA-list tombstone. A commit whose `commit_timestamp` falls in
// any tombstone range is excluded from link evidence, mirroring SHA-list
// behavior. If the only evidence was that commit, eligibility drops.

import { describe, expect, test } from "bun:test";
import { computeLinkerState, type LinkerInputs } from "./state";

const CLOCK = { now: () => "2026-04-18T12:00:00.000Z" };

function sha(n: number): string {
  return n.toString(16).padStart(40, "0");
}

function uuid(n: number): string {
  return `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
}

function hash(tag: string): Buffer {
  const b = Buffer.alloc(32);
  Buffer.from(tag).copy(b);
  return b;
}

describe("force-push RANGE tombstone (G3 / D53 extension)", () => {
  test("commit whose timestamp is IN a 30-min window is excluded from evidence", () => {
    const input: LinkerInputs = {
      tenant_id: uuid(1),
      tenant_mode: "all",
      installations: [{ installation_id: "inst-1", status: "active" }],
      repos: [{ provider_repo_id: "101", tracking_state: "inherit" }],
      session: {
        session_id: uuid(100),
        direct_provider_repo_ids: [],
        commit_shas: [sha(1)],
        commit_timestamps: ["2026-04-10T10:50:00.000Z"],
        pr_numbers: [],
      },
      pull_requests: [
        {
          provider_repo_id: "101",
          pr_number: 1,
          head_sha: sha(1),
          merge_commit_sha: null,
          state: "open",
          from_fork: false,
          title_hash: hash("t"),
          author_login_hash: hash("a"),
          additions: 0,
          deletions: 0,
          changed_files: 0,
        },
      ],
      deployments: [],
      aliases: [],
      tombstones: [
        {
          provider_repo_id: "101",
          excluded_shas: [],
          excluded_ranges: [
            { range_start: "2026-04-10T10:30:00.000Z", range_end: "2026-04-10T11:00:00.000Z" },
          ],
        },
      ],
    };

    const state = computeLinkerState(input, CLOCK);
    expect(state.links.length).toBe(0);
    expect(state.eligibility.eligible).toBe(false);
  });

  test("commit BEFORE the window: NOT excluded, eligibility preserved", () => {
    const input: LinkerInputs = {
      tenant_id: uuid(2),
      tenant_mode: "all",
      installations: [{ installation_id: "inst-2", status: "active" }],
      repos: [{ provider_repo_id: "201", tracking_state: "inherit" }],
      session: {
        session_id: uuid(200),
        direct_provider_repo_ids: [],
        commit_shas: [sha(2)],
        commit_timestamps: ["2026-04-10T09:00:00.000Z"],
        pr_numbers: [],
      },
      pull_requests: [
        {
          provider_repo_id: "201",
          pr_number: 1,
          head_sha: sha(2),
          merge_commit_sha: null,
          state: "open",
          from_fork: false,
          title_hash: hash("t"),
          author_login_hash: hash("a"),
          additions: 0,
          deletions: 0,
          changed_files: 0,
        },
      ],
      deployments: [],
      aliases: [],
      tombstones: [
        {
          provider_repo_id: "201",
          excluded_shas: [],
          excluded_ranges: [
            { range_start: "2026-04-10T10:30:00.000Z", range_end: "2026-04-10T11:00:00.000Z" },
          ],
        },
      ],
    };
    const state = computeLinkerState(input, CLOCK);
    expect(state.links.length).toBe(1);
    expect(state.eligibility.eligible).toBe(true);
  });

  test("range covers one of two commits: only the covered SHA is excluded", () => {
    const input: LinkerInputs = {
      tenant_id: uuid(3),
      tenant_mode: "all",
      installations: [{ installation_id: "inst-3", status: "active" }],
      repos: [{ provider_repo_id: "301", tracking_state: "inherit" }],
      session: {
        session_id: uuid(300),
        direct_provider_repo_ids: [],
        commit_shas: [sha(10), sha(11)],
        commit_timestamps: ["2026-04-10T10:50:00.000Z", "2026-04-10T12:00:00.000Z"],
        pr_numbers: [],
      },
      pull_requests: [
        {
          provider_repo_id: "301",
          pr_number: 1,
          head_sha: sha(10),
          merge_commit_sha: null,
          state: "open",
          from_fork: false,
          title_hash: hash("t10"),
          author_login_hash: hash("a10"),
          additions: 0,
          deletions: 0,
          changed_files: 0,
        },
        {
          provider_repo_id: "301",
          pr_number: 2,
          head_sha: sha(11),
          merge_commit_sha: null,
          state: "open",
          from_fork: false,
          title_hash: hash("t11"),
          author_login_hash: hash("a11"),
          additions: 0,
          deletions: 0,
          changed_files: 0,
        },
      ],
      deployments: [],
      aliases: [],
      tombstones: [
        {
          provider_repo_id: "301",
          excluded_shas: [],
          excluded_ranges: [
            { range_start: "2026-04-10T10:30:00.000Z", range_end: "2026-04-10T11:00:00.000Z" },
          ],
        },
      ],
    };
    const state = computeLinkerState(input, CLOCK);
    // Only sha(11) survives — it's outside the window.
    expect(state.links.length).toBe(1);
    expect(state.links[0]?.evidence.pr_number).toBe(2);
    expect(state.eligibility.eligible).toBe(true);
  });

  test("timestamps missing → range has no effect (G1 flat-SHA path only)", () => {
    const input: LinkerInputs = {
      tenant_id: uuid(4),
      tenant_mode: "all",
      installations: [{ installation_id: "inst-4", status: "active" }],
      repos: [{ provider_repo_id: "401", tracking_state: "inherit" }],
      session: {
        session_id: uuid(400),
        direct_provider_repo_ids: [],
        commit_shas: [sha(20)],
        // commit_timestamps omitted — G1-era session_enrichment shape.
        pr_numbers: [],
      },
      pull_requests: [
        {
          provider_repo_id: "401",
          pr_number: 1,
          head_sha: sha(20),
          merge_commit_sha: null,
          state: "open",
          from_fork: false,
          title_hash: hash("t"),
          author_login_hash: hash("a"),
          additions: 0,
          deletions: 0,
          changed_files: 0,
        },
      ],
      deployments: [],
      aliases: [],
      tombstones: [
        {
          provider_repo_id: "401",
          excluded_shas: [],
          // Covers the timestamp of sha(20) were it present — but we have no
          // timestamp, so the range is inert.
          excluded_ranges: [
            { range_start: "2000-01-01T00:00:00.000Z", range_end: "3000-01-01T00:00:00.000Z" },
          ],
        },
      ],
    };
    const state = computeLinkerState(input, CLOCK);
    expect(state.links.length).toBe(1);
    expect(state.eligibility.eligible).toBe(true);
  });
});
