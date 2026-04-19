// Generates the 12 G1 edge-case fixtures (PRD §13 Phase G1).
//
// Run via: `bun run packages/fixtures/src/github/build-g1.ts`.
//
// Each fixture is written to `packages/fixtures/github/<event>/<scenario>.json`
// alongside the sidecar `<scenario>.headers.json` containing X-GitHub-Event,
// X-GitHub-Delivery, and X-Hub-Signature-256 computed against the committed
// `.webhook-secret` (same mechanism as G0 fixtures). We stabilize the JSON
// payload by JSON.stringify'ing it with 2-space indent so signatures are
// reproducible from commit-to-commit.
//
// All payloads use the shared fixture identity (fixture-org / fixture-repo /
// fixture-engineer) + the "0000…0001" SHA pattern used in G0. The redaction
// gate (`fixtures.redaction.test.ts`) runs over every written file before the
// PR lands.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeHubSignature256, readFixtureSecret } from "./sign";

const FIXTURES_ROOT = resolve(import.meta.dir, "..", "..", "github");
const SECRET = readFixtureSecret(resolve(import.meta.dir, "..", ".."));

const ORG_LOGIN = "fixture-org";
const ORG_ID = 123456;
const ORG_NODE_ID = "O_kgDOFIXTUREORG";
const REPO_ID = 987654321;
const REPO_NODE_ID = "R_kgDOFIXTURE001";
const REPO_NAME = "fixture-repo";
const REPO_FULL_NAME = `${ORG_LOGIN}/${REPO_NAME}`;
const INSTALLATION_ID = 42424242;
const INSTALLATION_NODE_ID = "MDIzOkZJWFRVUkUwMDE=";
const SENDER_LOGIN = "fixture-engineer";
const SENDER_ID = 555111;
const SENDER_NODE_ID = "U_kgDOFIXTURE_SENDER";
const APP_ID = 909090;

const repoBlock = {
  id: REPO_ID,
  node_id: REPO_NODE_ID,
  name: REPO_NAME,
  full_name: REPO_FULL_NAME,
  private: false,
  owner: {
    login: ORG_LOGIN,
    id: ORG_ID,
    node_id: ORG_NODE_ID,
    type: "Organization",
    site_admin: false,
  },
  html_url: `https://bematist.local/${REPO_FULL_NAME}`,
  description: null,
  fork: false,
  default_branch: "main",
  clone_url: `https://bematist.local/${REPO_FULL_NAME}`,
};

const senderBlock = {
  login: SENDER_LOGIN,
  id: SENDER_ID,
  node_id: SENDER_NODE_ID,
  type: "User",
  site_admin: false,
};

const installationBlock = {
  id: INSTALLATION_ID,
  node_id: INSTALLATION_NODE_ID,
};

function prBase(opts: {
  node_id: string;
  number: number;
  state: "open" | "closed";
  mergedAt: string | null;
  mergeSha: string | null;
  headSha: string;
  baseSha: string;
  draft?: boolean;
  additions?: number;
  deletions?: number;
  commits?: number;
  changedFiles?: number;
  fork?: boolean;
  body?: string;
  title?: string;
  author_association?: string;
}): Record<string, unknown> {
  const headRepo = opts.fork
    ? { ...repoBlock, id: 111222333, node_id: "R_kgDOFIXTUREFORK", name: "fixture-repo-fork" }
    : repoBlock;
  return {
    id: 111000 + opts.number,
    node_id: opts.node_id,
    number: opts.number,
    state: opts.state,
    locked: false,
    title: opts.title ?? "Fixture PR title — redacted",
    user: senderBlock,
    body: opts.body ?? "Fixture body — redacted.",
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:05:00Z",
    closed_at: opts.state === "closed" ? "2026-04-01T01:00:00Z" : null,
    merged_at: opts.mergedAt,
    merge_commit_sha: opts.mergeSha,
    assignees: [],
    requested_reviewers: [],
    requested_teams: [],
    labels: [],
    milestone: null,
    draft: opts.draft ?? false,
    head: {
      label: `${ORG_LOGIN}:feature/fixture-branch`,
      ref: "feature/fixture-branch",
      sha: opts.headSha,
      user: senderBlock,
      repo: headRepo,
    },
    base: {
      label: `${ORG_LOGIN}:main`,
      ref: "main",
      sha: opts.baseSha,
      user: senderBlock,
      repo: repoBlock,
    },
    author_association: opts.author_association ?? "MEMBER",
    auto_merge: null,
    active_lock_reason: null,
    merged: opts.mergedAt !== null,
    mergeable: true,
    rebaseable: true,
    mergeable_state: "clean",
    merged_by: opts.mergedAt !== null ? senderBlock : null,
    comments: 0,
    review_comments: 0,
    maintainer_can_modify: false,
    commits: opts.commits ?? 1,
    additions: opts.additions ?? 42,
    deletions: opts.deletions ?? 3,
    changed_files: opts.changedFiles ?? 2,
  };
}

interface FixtureSpec {
  event: string;
  scenario: string;
  payload: Record<string, unknown>;
}

const fixtures: FixtureSpec[] = [
  // 1. pull_request.closed (merged via rebase — merge_commit_sha = head_sha-ish but
  //    we carry a distinct sha to exercise the rebase branch).
  {
    event: "pull_request",
    scenario: "closed-merged-rebase",
    payload: {
      action: "closed",
      number: 8,
      pull_request: prBase({
        node_id: "PR_kwDOFIXTURE008",
        number: 8,
        state: "closed",
        mergedAt: "2026-04-01T01:00:00Z",
        mergeSha: "0000000000000000000000000000000000000008",
        headSha: "0000000000000000000000000000000000000008",
        baseSha: "0000000000000000000000000000000000000002",
        additions: 15,
        deletions: 2,
      }),
      repository: repoBlock,
      sender: senderBlock,
      installation: installationBlock,
      organization: { login: ORG_LOGIN, id: ORG_ID, node_id: ORG_NODE_ID },
    },
  },
  // 2. pull_request.closed (NOT merged — closed unmerged)
  {
    event: "pull_request",
    scenario: "closed-unmerged",
    payload: {
      action: "closed",
      number: 9,
      pull_request: prBase({
        node_id: "PR_kwDOFIXTURE009",
        number: 9,
        state: "closed",
        mergedAt: null,
        mergeSha: null,
        headSha: "0000000000000000000000000000000000000009",
        baseSha: "0000000000000000000000000000000000000002",
        additions: 7,
        deletions: 1,
      }),
      repository: repoBlock,
      sender: senderBlock,
      installation: installationBlock,
      organization: { login: ORG_LOGIN, id: ORG_ID, node_id: ORG_NODE_ID },
    },
  },
  // 3. pull_request.opened from a fork
  {
    event: "pull_request",
    scenario: "opened-from-fork",
    payload: {
      action: "opened",
      number: 10,
      pull_request: prBase({
        node_id: "PR_kwDOFIXTURE010",
        number: 10,
        state: "open",
        mergedAt: null,
        mergeSha: null,
        headSha: "0000000000000000000000000000000000000010",
        baseSha: "0000000000000000000000000000000000000002",
        fork: true,
        author_association: "CONTRIBUTOR",
      }),
      repository: repoBlock,
      sender: senderBlock,
      installation: installationBlock,
      organization: { login: ORG_LOGIN, id: ORG_ID, node_id: ORG_NODE_ID },
    },
  },
  // 4. pull_request.edited (body contains a "Closes #N" keyword — parser
  //    keeps the UPSERT path; closes-issue linking is Phase 2).
  {
    event: "pull_request",
    scenario: "edited-with-closes-keyword",
    payload: {
      action: "edited",
      number: 11,
      changes: {
        body: { from: "Previous body." },
      },
      pull_request: prBase({
        node_id: "PR_kwDOFIXTURE011",
        number: 11,
        state: "open",
        mergedAt: null,
        mergeSha: null,
        headSha: "0000000000000000000000000000000000000011",
        baseSha: "0000000000000000000000000000000000000002",
        body: "Closes #42 — fixture description",
      }),
      repository: repoBlock,
      sender: senderBlock,
      installation: installationBlock,
      organization: { login: ORG_LOGIN, id: ORG_ID, node_id: ORG_NODE_ID },
    },
  },
  // 5. push to default branch (distinct from G0 regular.json which is also
  //    to main — this variant stresses a multi-commit push to the default).
  {
    event: "push",
    scenario: "to-default-branch",
    payload: {
      ref: "refs/heads/main",
      before: "0000000000000000000000000000000000000020",
      after: "0000000000000000000000000000000000000022",
      created: false,
      deleted: false,
      forced: false,
      compare: `https://bematist.local/${REPO_FULL_NAME}/compare/000000...000000`,
      pusher: { name: SENDER_LOGIN, email: `${SENDER_LOGIN}@example.com` },
      commits: [
        {
          id: "0000000000000000000000000000000000000021",
          tree_id: "0000000000000000000000000000000000000121",
          distinct: true,
          message: "fixture: intermediate change",
          timestamp: "2026-04-01T00:05:00Z",
          url: `https://bematist.local/${REPO_FULL_NAME}/commit/0000000000000000000000000000000000000021`,
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
        {
          id: "0000000000000000000000000000000000000022",
          tree_id: "0000000000000000000000000000000000000122",
          distinct: true,
          message: "fixture: latest change",
          timestamp: "2026-04-01T00:06:00Z",
          url: `https://bematist.local/${REPO_FULL_NAME}/commit/0000000000000000000000000000000000000022`,
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
      ],
      head_commit: {
        id: "0000000000000000000000000000000000000022",
        tree_id: "0000000000000000000000000000000000000122",
        distinct: true,
        message: "fixture: latest change",
        timestamp: "2026-04-01T00:06:00Z",
        url: `https://bematist.local/${REPO_FULL_NAME}/commit/0000000000000000000000000000000000000022`,
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
      repository: repoBlock,
      sender: senderBlock,
      installation: installationBlock,
    },
  },
  // 6. push to non-default branch
  {
    event: "push",
    scenario: "to-non-default",
    payload: {
      ref: "refs/heads/feature/fixture-branch",
      before: "0000000000000000000000000000000000000030",
      after: "0000000000000000000000000000000000000031",
      created: false,
      deleted: false,
      forced: false,
      compare: `https://bematist.local/${REPO_FULL_NAME}/compare/000000...000000`,
      pusher: { name: SENDER_LOGIN, email: `${SENDER_LOGIN}@example.com` },
      commits: [
        {
          id: "0000000000000000000000000000000000000031",
          tree_id: "0000000000000000000000000000000000000131",
          distinct: true,
          message: "fixture: feature branch commit",
          timestamp: "2026-04-01T00:10:00Z",
          url: `https://bematist.local/${REPO_FULL_NAME}/commit/0000000000000000000000000000000000000031`,
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
      ],
      head_commit: {
        id: "0000000000000000000000000000000000000031",
        tree_id: "0000000000000000000000000000000000000131",
        distinct: true,
        message: "fixture: feature branch commit",
        timestamp: "2026-04-01T00:10:00Z",
        url: `https://bematist.local/${REPO_FULL_NAME}/commit/0000000000000000000000000000000000000031`,
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
      repository: repoBlock,
      sender: senderBlock,
      installation: installationBlock,
    },
  },
  // 7. check_suite.completed with conclusion=failure
  {
    event: "check_suite",
    scenario: "completed-failure",
    payload: {
      action: "completed",
      check_suite: {
        id: 700002,
        node_id: "CS_kwDOFIXTURE002",
        head_branch: "feature/fixture-branch",
        head_sha: "0000000000000000000000000000000000000040",
        status: "completed",
        conclusion: "failure",
        url: `https://bematist.local/${REPO_FULL_NAME}/check-suites/700002`,
        before: "0000000000000000000000000000000000000002",
        after: "0000000000000000000000000000000000000040",
        pull_requests: [
          {
            id: 111012,
            number: 12,
            head: {
              ref: "feature/fixture-branch",
              sha: "0000000000000000000000000000000000000040",
              repo: { id: REPO_ID, name: REPO_NAME },
            },
            base: {
              ref: "main",
              sha: "0000000000000000000000000000000000000002",
              repo: { id: REPO_ID, name: REPO_NAME },
            },
          },
        ],
        app: { id: APP_ID, slug: "bematist-fixture-app", name: "Bematist Fixture App" },
        created_at: "2026-04-01T00:05:30Z",
        updated_at: "2026-04-01T00:12:00Z",
        latest_check_runs_count: 5,
      },
      repository: repoBlock,
      sender: senderBlock,
      installation: installationBlock,
    },
  },
  // 8. installation.suspend
  {
    event: "installation",
    scenario: "suspend",
    payload: {
      action: "suspend",
      installation: {
        id: INSTALLATION_ID,
        node_id: INSTALLATION_NODE_ID,
        account: {
          login: ORG_LOGIN,
          id: ORG_ID,
          node_id: ORG_NODE_ID,
          type: "Organization",
          site_admin: false,
        },
        repository_selection: "selected",
        app_id: APP_ID,
        app_slug: "bematist-fixture-app",
        target_id: ORG_ID,
        target_type: "Organization",
        suspended_at: "2026-04-01T02:00:00Z",
        suspended_by: senderBlock,
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
      sender: senderBlock,
    },
  },
  // 9. installation.unsuspend
  {
    event: "installation",
    scenario: "unsuspend",
    payload: {
      action: "unsuspend",
      installation: {
        id: INSTALLATION_ID,
        node_id: INSTALLATION_NODE_ID,
        account: {
          login: ORG_LOGIN,
          id: ORG_ID,
          node_id: ORG_NODE_ID,
          type: "Organization",
          site_admin: false,
        },
        repository_selection: "selected",
        app_id: APP_ID,
        app_slug: "bematist-fixture-app",
        target_id: ORG_ID,
        target_type: "Organization",
        suspended_at: null,
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
      sender: senderBlock,
    },
  },
  // 10. installation.deleted
  {
    event: "installation",
    scenario: "deleted",
    payload: {
      action: "deleted",
      installation: {
        id: INSTALLATION_ID,
        node_id: INSTALLATION_NODE_ID,
        account: {
          login: ORG_LOGIN,
          id: ORG_ID,
          node_id: ORG_NODE_ID,
          type: "Organization",
          site_admin: false,
        },
        repository_selection: "selected",
        app_id: APP_ID,
        app_slug: "bematist-fixture-app",
        target_id: ORG_ID,
        target_type: "Organization",
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
      sender: senderBlock,
    },
  },
  // 11. repository.renamed
  {
    event: "repository",
    scenario: "renamed",
    payload: {
      action: "renamed",
      changes: {
        repository: {
          name: {
            from: "fixture-repo-old",
          },
        },
      },
      repository: repoBlock,
      sender: senderBlock,
      installation: installationBlock,
      organization: { login: ORG_LOGIN, id: ORG_ID, node_id: ORG_NODE_ID },
    },
  },
  // 12. repository.transferred
  {
    event: "repository",
    scenario: "transferred",
    payload: {
      action: "transferred",
      changes: {
        owner: {
          from: {
            user: null,
            organization: {
              login: "fixture-prev-org",
              id: 111100,
              node_id: "O_kgDOFIXTUREPREV",
              type: "Organization",
              site_admin: false,
            },
          },
        },
      },
      repository: repoBlock,
      sender: senderBlock,
      installation: installationBlock,
      organization: { login: ORG_LOGIN, id: ORG_ID, node_id: ORG_NODE_ID },
    },
  },
];

function writeFixture(spec: FixtureSpec): void {
  const body = JSON.stringify(spec.payload, null, 2);
  const payloadPath = resolve(FIXTURES_ROOT, spec.event, `${spec.scenario}.json`);
  const headersPath = resolve(FIXTURES_ROOT, spec.event, `${spec.scenario}.headers.json`);
  writeFileSync(payloadPath, `${body}\n`);
  const sig = computeHubSignature256(`${body}\n`, SECRET);
  const headers = {
    "X-GitHub-Event": spec.event,
    "X-GitHub-Delivery": `fixture-${spec.event}-${spec.scenario}`,
    "X-Hub-Signature-256": sig,
  };
  writeFileSync(headersPath, `${JSON.stringify(headers, null, 2)}\n`);
}

for (const spec of fixtures) {
  writeFixture(spec);
}
