#!/usr/bin/env bun
// Seed the eight G0 foundation fixtures (PRD §13 Phase G0 bullet #4).
//
// Hand-crafted payloads that mirror GitHub's canonical webhook schemas
// (https://docs.github.com/en/webhooks/webhook-events-and-payloads) but are
// fully redacted to the fixture-domain allowlist (example.com, test.invalid,
// bematist.local). Each payload is piped through `record()` — the same code
// path `bun run fixtures:github:record` uses — so redaction + signing are
// identical to the one-shot CLI.
//
// Run:  bun run packages/fixtures/src/github/seed-g0.ts
//
// Writes (relative to packages/fixtures):
//
//   github/pull_request/opened.{json,headers.json}
//   github/pull_request/synchronize.{json,headers.json}
//   github/pull_request/closed-merged-squash.{json,headers.json}
//   github/push/regular.{json,headers.json}
//   github/push/forced.{json,headers.json}
//   github/check_suite/completed-success.{json,headers.json}
//   github/workflow_run/completed.{json,headers.json}
//   github/installation/created.{json,headers.json}

import { resolve } from "node:path";
import { record } from "./record";

const FIXTURES_ROOT = resolve(import.meta.dir, "..", "..");

// Shared redacted fixtures — reused across multiple payloads so the linker
// tests can see repeat repo IDs and owner logins without hidden variance.
const REPO_NODE_ID = "R_kgDOFIXTURE001";
const REPO_ID = 987654321;
const REPO_OWNER_LOGIN = "fixture-org";
const REPO_NAME = "fixture-repo";
const REPO_FULL_NAME = `${REPO_OWNER_LOGIN}/${REPO_NAME}`;
const REPO_HTML_URL = `https://bematist.local/${REPO_FULL_NAME}`;
// Clone URL omits the traditional `.git` suffix — `.git` is a real TLD and
// would trip the fixture-redaction gate. Ingest doesn't parse this field in
// G0/G1 so the suffix is decoration only.
const REPO_CLONE_URL = `https://bematist.local/${REPO_FULL_NAME}`;

const INSTALLATION_ID = 42424242;
const APP_ID = 909090;
const ORG_ID = 123456;
const ORG_LOGIN = REPO_OWNER_LOGIN;
const SENDER_LOGIN = "fixture-engineer";
const SENDER_ID = 555111;

const HEAD_SHA = "0000000000000000000000000000000000000001";
const BASE_SHA = "0000000000000000000000000000000000000002";
const MERGE_SHA = "0000000000000000000000000000000000000003";
const FORCED_AFTER_SHA = "0000000000000000000000000000000000000004";
const FORCED_BEFORE_SHA = "0000000000000000000000000000000000000005";

function repo(nodeIdOverride?: string) {
  return {
    id: REPO_ID,
    node_id: nodeIdOverride ?? REPO_NODE_ID,
    name: REPO_NAME,
    full_name: REPO_FULL_NAME,
    private: false,
    owner: {
      login: REPO_OWNER_LOGIN,
      id: ORG_ID,
      node_id: "O_kgDOFIXTUREORG",
      type: "Organization",
      site_admin: false,
    },
    html_url: REPO_HTML_URL,
    description: null,
    fork: false,
    default_branch: "main",
    clone_url: REPO_CLONE_URL,
  };
}

function sender() {
  return {
    login: SENDER_LOGIN,
    id: SENDER_ID,
    node_id: "U_kgDOFIXTURE_SENDER",
    type: "User",
    site_admin: false,
  };
}

function installationRef() {
  return { id: INSTALLATION_ID, node_id: "MDIzOkZJWFRVUkUwMDE=" };
}

function pullRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 111001,
    node_id: "PR_kwDOFIXTURE001",
    number: 7,
    state: "open",
    locked: false,
    title: "Fixture PR title — redacted",
    user: sender(),
    body: "Fixture body — redacted.",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:05:00Z",
    closed_at: null,
    merged_at: null,
    merge_commit_sha: null,
    assignees: [],
    requested_reviewers: [],
    requested_teams: [],
    labels: [],
    milestone: null,
    draft: false,
    head: {
      label: `${REPO_OWNER_LOGIN}:feature/fixture-branch`,
      ref: "feature/fixture-branch",
      sha: HEAD_SHA,
      user: sender(),
      repo: repo(),
    },
    base: {
      label: `${REPO_OWNER_LOGIN}:main`,
      ref: "main",
      sha: BASE_SHA,
      user: sender(),
      repo: repo(),
    },
    author_association: "MEMBER",
    auto_merge: null,
    active_lock_reason: null,
    merged: false,
    mergeable: true,
    rebaseable: true,
    mergeable_state: "clean",
    merged_by: null,
    comments: 0,
    review_comments: 0,
    maintainer_can_modify: false,
    commits: 1,
    additions: 42,
    deletions: 3,
    changed_files: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 8 payloads.
// ---------------------------------------------------------------------------

const PAYLOADS: Array<{ event: string; scenario: string; body: unknown }> = [
  {
    event: "pull_request",
    scenario: "opened",
    body: {
      action: "opened",
      number: 7,
      pull_request: pullRequest(),
      repository: repo(),
      sender: sender(),
      installation: installationRef(),
      organization: {
        login: ORG_LOGIN,
        id: ORG_ID,
        node_id: "O_kgDOFIXTUREORG",
      },
    },
  },
  {
    event: "pull_request",
    scenario: "synchronize",
    body: {
      action: "synchronize",
      number: 7,
      before: BASE_SHA,
      after: HEAD_SHA,
      pull_request: pullRequest({
        updated_at: "2026-04-01T00:30:00Z",
        head: {
          label: `${REPO_OWNER_LOGIN}:feature/fixture-branch`,
          ref: "feature/fixture-branch",
          sha: HEAD_SHA,
          user: sender(),
          repo: repo(),
        },
      }),
      repository: repo(),
      sender: sender(),
      installation: installationRef(),
    },
  },
  {
    event: "pull_request",
    scenario: "closed-merged-squash",
    body: {
      action: "closed",
      number: 7,
      pull_request: pullRequest({
        state: "closed",
        closed_at: "2026-04-01T01:00:00Z",
        merged_at: "2026-04-01T01:00:00Z",
        merged: true,
        merge_commit_sha: MERGE_SHA,
        merged_by: sender(),
        // GitHub squash merges collapse to a single commit; the payload still
        // reports the logical commit count that was squashed.
        commits: 3,
      }),
      repository: repo(),
      sender: sender(),
      installation: installationRef(),
    },
  },
  {
    event: "push",
    scenario: "regular",
    body: {
      ref: "refs/heads/main",
      before: BASE_SHA,
      after: HEAD_SHA,
      created: false,
      deleted: false,
      forced: false,
      compare: `https://bematist.local/${REPO_FULL_NAME}/compare/${BASE_SHA.slice(0, 12)}...${HEAD_SHA.slice(0, 12)}`,
      pusher: { name: SENDER_LOGIN, email: `${SENDER_LOGIN}@example.com` },
      commits: [
        {
          id: HEAD_SHA,
          tree_id: "0000000000000000000000000000000000000100",
          distinct: true,
          message: "fixture: add redacted file",
          timestamp: "2026-04-01T00:05:00Z",
          url: `https://bematist.local/${REPO_FULL_NAME}/commit/${HEAD_SHA}`,
          author: {
            name: "Fixture Engineer",
            email: `${SENDER_LOGIN}@example.com`,
            username: SENDER_LOGIN,
          },
          committer: {
            name: "Fixture Engineer",
            email: `${SENDER_LOGIN}@example.com`,
            username: SENDER_LOGIN,
          },
          added: ["FIXTURE_CHANGELOG"],
          removed: [],
          modified: [],
        },
      ],
      head_commit: {
        id: HEAD_SHA,
        tree_id: "0000000000000000000000000000000000000100",
        distinct: true,
        message: "fixture: add redacted file",
        timestamp: "2026-04-01T00:05:00Z",
        url: `https://bematist.local/${REPO_FULL_NAME}/commit/${HEAD_SHA}`,
        author: {
          name: "Fixture Engineer",
          email: `${SENDER_LOGIN}@example.com`,
          username: SENDER_LOGIN,
        },
        committer: {
          name: "Fixture Engineer",
          email: `${SENDER_LOGIN}@example.com`,
          username: SENDER_LOGIN,
        },
        added: ["FIXTURE_CHANGELOG"],
        removed: [],
        modified: [],
      },
      repository: repo(),
      sender: sender(),
      installation: installationRef(),
    },
  },
  {
    event: "push",
    scenario: "forced",
    body: {
      ref: "refs/heads/feature/fixture-branch",
      before: FORCED_BEFORE_SHA,
      after: FORCED_AFTER_SHA,
      created: false,
      deleted: false,
      forced: true,
      compare: `https://bematist.local/${REPO_FULL_NAME}/compare/${FORCED_BEFORE_SHA.slice(0, 12)}...${FORCED_AFTER_SHA.slice(0, 12)}`,
      pusher: { name: SENDER_LOGIN, email: `${SENDER_LOGIN}@example.com` },
      commits: [],
      head_commit: {
        id: FORCED_AFTER_SHA,
        tree_id: "0000000000000000000000000000000000000101",
        distinct: true,
        message: "fixture: force-push rewrite",
        timestamp: "2026-04-01T01:15:00Z",
        url: `https://bematist.local/${REPO_FULL_NAME}/commit/${FORCED_AFTER_SHA}`,
        author: {
          name: "Fixture Engineer",
          email: `${SENDER_LOGIN}@example.com`,
          username: SENDER_LOGIN,
        },
        committer: {
          name: "Fixture Engineer",
          email: `${SENDER_LOGIN}@example.com`,
          username: SENDER_LOGIN,
        },
        added: [],
        removed: [],
        modified: ["FIXTURE_CHANGELOG"],
      },
      repository: repo(),
      sender: sender(),
      installation: installationRef(),
    },
  },
  {
    event: "check_suite",
    scenario: "completed-success",
    body: {
      action: "completed",
      check_suite: {
        id: 700001,
        node_id: "CS_kwDOFIXTURE001",
        head_branch: "feature/fixture-branch",
        head_sha: HEAD_SHA,
        status: "completed",
        conclusion: "success",
        url: `https://bematist.local/${REPO_FULL_NAME}/check-suites/700001`,
        before: BASE_SHA,
        after: HEAD_SHA,
        pull_requests: [
          {
            id: 111001,
            number: 7,
            head: {
              ref: "feature/fixture-branch",
              sha: HEAD_SHA,
              repo: { id: REPO_ID, name: REPO_NAME },
            },
            base: { ref: "main", sha: BASE_SHA, repo: { id: REPO_ID, name: REPO_NAME } },
          },
        ],
        app: { id: APP_ID, slug: "bematist-fixture-app", name: "Bematist Fixture App" },
        created_at: "2026-04-01T00:05:30Z",
        updated_at: "2026-04-01T00:10:00Z",
        latest_check_runs_count: 3,
      },
      repository: repo(),
      sender: sender(),
      installation: installationRef(),
    },
  },
  {
    event: "workflow_run",
    scenario: "completed",
    body: {
      action: "completed",
      workflow: {
        id: 800001,
        node_id: "W_kwDOFIXTUREWORKFLOW",
        name: "CI",
        path: ".github/workflows/ci.yml",
        state: "active",
        url: `https://bematist.local/${REPO_FULL_NAME}/actions/workflows/ci.yml`,
      },
      workflow_run: {
        id: 800002,
        node_id: "WR_kwDOFIXTURE002",
        name: "CI",
        head_branch: "feature/fixture-branch",
        head_sha: HEAD_SHA,
        run_number: 42,
        event: "pull_request",
        display_title: "fixture: redacted",
        status: "completed",
        conclusion: "success",
        workflow_id: 800001,
        url: `https://bematist.local/${REPO_FULL_NAME}/actions/runs/800002`,
        html_url: `https://bematist.local/${REPO_FULL_NAME}/actions/runs/800002`,
        created_at: "2026-04-01T00:05:30Z",
        updated_at: "2026-04-01T00:10:00Z",
        run_started_at: "2026-04-01T00:05:45Z",
        pull_requests: [
          {
            id: 111001,
            number: 7,
            head: {
              ref: "feature/fixture-branch",
              sha: HEAD_SHA,
              repo: { id: REPO_ID, name: REPO_NAME },
            },
            base: { ref: "main", sha: BASE_SHA, repo: { id: REPO_ID, name: REPO_NAME } },
          },
        ],
      },
      repository: repo(),
      sender: sender(),
      installation: installationRef(),
    },
  },
  {
    event: "installation",
    scenario: "created",
    body: {
      action: "created",
      installation: {
        id: INSTALLATION_ID,
        node_id: "MDIzOkZJWFRVUkUwMDE=",
        account: {
          login: ORG_LOGIN,
          id: ORG_ID,
          node_id: "O_kgDOFIXTUREORG",
          type: "Organization",
          site_admin: false,
        },
        repository_selection: "selected",
        access_tokens_url: `https://bematist.local/api/v3/app/installations/${INSTALLATION_ID}/access_tokens`,
        repositories_url: `https://bematist.local/api/v3/installation/repositories`,
        html_url: `https://bematist.local/organizations/${ORG_LOGIN}/settings/installations/${INSTALLATION_ID}`,
        app_id: APP_ID,
        app_slug: "bematist-fixture-app",
        target_id: ORG_ID,
        target_type: "Organization",
        permissions: {
          actions: "read",
          checks: "read",
          contents: "read",
          metadata: "read",
          pull_requests: "read",
          statuses: "read",
        },
        events: ["pull_request", "push", "check_suite", "workflow_run"],
        created_at: "2026-04-01T00:00:00Z",
        updated_at: "2026-04-01T00:00:00Z",
        single_file_name: null,
        has_multiple_single_files: false,
      },
      repositories: [
        {
          id: REPO_ID,
          node_id: REPO_NODE_ID,
          name: REPO_NAME,
          full_name: REPO_FULL_NAME,
          private: false,
        },
      ],
      sender: sender(),
    },
  },
];

for (const p of PAYLOADS) {
  const raw = JSON.stringify(p.body);
  const out = record({
    event: p.event,
    scenario: p.scenario,
    rawBody: raw,
    fixturesRoot: FIXTURES_ROOT,
  });
  process.stdout.write(
    `seeded ${p.event}/${p.scenario} → ${out.payloadPath.slice(FIXTURES_ROOT.length + 1)}\n`,
  );
}
