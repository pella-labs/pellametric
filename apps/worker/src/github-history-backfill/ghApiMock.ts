// Test-only in-process GitHub API mock for the history-backfill worker.
//
// Covers the exact REST subset the backfill paginator touches:
//   GET /repos/{owner}/{repo}/pulls?...&page=N
//   GET /repos/{owner}/{repo}/commits?...&page=N
//
// Honors X-RateLimit-Remaining / X-RateLimit-Reset + supports per-page 429/
// 403 overrides so the secondary-rate-limit path is testable without a real
// GitHub hit.

export interface PageOverride {
  rateLimitRemaining?: number;
  rateLimitResetEpochSec?: number;
  status?: number;
  retryAfterSec?: number;
}

export interface RepoFixture {
  owner: string;
  name: string;
  pulls: unknown[]; // ordered desc by updated_at (caller's responsibility)
  commits: unknown[];
}

export interface MockApiOpts {
  repos: RepoFixture[];
  perPage?: number;
  /** Keyed by `${owner}/${name}/${kind}/${page}`. */
  pageOverrides?: Record<string, PageOverride>;
  clock?: () => number;
  onRequest?: (info: {
    url: string;
    owner: string;
    name: string;
    kind: "pulls" | "commits";
    page: number;
    at: number;
  }) => void;
}

export interface MockApi {
  fetch: typeof fetch;
  readonly requestCount: number;
  readonly history: Array<{
    url: string;
    owner: string;
    name: string;
    kind: "pulls" | "commits";
    page: number;
    at: number;
  }>;
  readonly pullsRequestCountByRepo: Record<string, number>;
  readonly commitsRequestCountByRepo: Record<string, number>;
}

export function createMockGitHubApi(opts: MockApiOpts): MockApi {
  const perPage = opts.perPage ?? 100;
  const clock = opts.clock ?? (() => Date.now());
  const history: MockApi["history"] = [];
  const pullsCount: Record<string, number> = {};
  const commitsCount: Record<string, number> = {};
  const byKey = new Map(opts.repos.map((r) => [`${r.owner}/${r.name}`, r]));

  const fetchFn = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const u = new URL(url);
    // Parse /repos/{owner}/{repo}/pulls OR /commits
    const segs = u.pathname.split("/").filter(Boolean);
    // ["repos","owner","repo","pulls"|"commits"]
    const owner = segs[1] ?? "";
    const name = segs[2] ?? "";
    const kind = (segs[3] ?? "") as "pulls" | "commits";
    const page = Number(u.searchParams.get("page") ?? "1");
    const entry = { url, owner, name, kind, page, at: clock() };
    history.push(entry);
    opts.onRequest?.(entry);
    if (kind === "pulls")
      pullsCount[`${owner}/${name}`] = (pullsCount[`${owner}/${name}`] ?? 0) + 1;
    else commitsCount[`${owner}/${name}`] = (commitsCount[`${owner}/${name}`] ?? 0) + 1;

    const overrideKey = `${owner}/${name}/${kind}/${page}`;
    const override = opts.pageOverrides?.[overrideKey];
    if (override?.status && override.status !== 200) {
      const headers = new Headers({ "content-type": "application/json" });
      if (override.retryAfterSec !== undefined) {
        headers.set("retry-after", String(override.retryAfterSec));
      }
      return new Response(JSON.stringify({ message: "rate limited" }), {
        status: override.status,
        headers,
      });
    }

    const repo = byKey.get(`${owner}/${name}`);
    if (!repo) {
      return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    }
    const full = kind === "pulls" ? repo.pulls : repo.commits;
    const start = (page - 1) * perPage;
    const end = start + perPage;
    const slice = full.slice(start, end);
    const totalPages = Math.max(1, Math.ceil(full.length / perPage));

    const links: string[] = [];
    const baseUrl = `${u.origin}${u.pathname}`;
    const query = new URLSearchParams(u.searchParams);
    if (page < totalPages) {
      query.set("page", String(page + 1));
      links.push(`<${baseUrl}?${query.toString()}>; rel="next"`);
    }
    const remaining = override?.rateLimitRemaining ?? 4999;
    const resetEpoch = override?.rateLimitResetEpochSec ?? Math.floor(clock() / 1000) + 3600;
    const headers = new Headers({
      "content-type": "application/json",
      "x-ratelimit-remaining": String(remaining),
      "x-ratelimit-reset": String(resetEpoch),
      "x-ratelimit-limit": "5000",
    });
    if (links.length > 0) headers.set("link", links.join(", "));

    return new Response(JSON.stringify(slice), { status: 200, headers });
  }) as typeof fetch;

  return Object.defineProperties({ fetch: fetchFn } as MockApi, {
    requestCount: { get: () => history.length, enumerable: true },
    history: { get: () => history, enumerable: true },
    pullsRequestCountByRepo: { get: () => pullsCount, enumerable: true },
    commitsRequestCountByRepo: { get: () => commitsCount, enumerable: true },
  });
}

// Fixture builders -----------------------------------------------------------

export function makePulls(
  n: number,
  repoId: number,
  opts?: { baseTs?: number; olderTs?: number; olderCount?: number },
): unknown[] {
  const baseTs = opts?.baseTs ?? Date.parse("2026-04-10T00:00:00Z");
  const olderTs = opts?.olderTs ?? Date.parse("2026-01-01T00:00:00Z");
  const older = opts?.olderCount ?? 0;
  const pulls: unknown[] = [];
  // Recent first (desc by updated_at).
  for (let i = 0; i < n; i++) {
    const ts = new Date(baseTs - i * 60_000).toISOString();
    pulls.push({
      number: 1000 + i,
      node_id: `PR_node_${repoId}_${1000 + i}`,
      state: "open",
      draft: false,
      title: `feat: change ${i}`,
      body: "",
      user: { login: `dev${i % 5}` },
      base: { ref: "main" },
      head: { ref: `feature-${i}`, sha: sha(repoId, i, "h"), repo: { id: repoId } },
      merge_commit_sha: null,
      additions: 10,
      deletions: 2,
      changed_files: 1,
      commits: 1,
      created_at: ts,
      updated_at: ts,
      closed_at: null,
      merged_at: null,
      author_association: "MEMBER",
    });
  }
  for (let i = 0; i < older; i++) {
    const ts = new Date(olderTs - i * 60_000).toISOString();
    pulls.push({
      number: 2000 + i,
      node_id: `PR_node_${repoId}_${2000 + i}`,
      state: "closed",
      draft: false,
      title: `old change ${i}`,
      body: "",
      user: { login: "dev0" },
      base: { ref: "main" },
      head: { ref: `old-${i}`, sha: sha(repoId, i, "o"), repo: { id: repoId } },
      merge_commit_sha: null,
      additions: 1,
      deletions: 1,
      changed_files: 1,
      commits: 1,
      created_at: ts,
      updated_at: ts,
      closed_at: ts,
      merged_at: null,
      author_association: "MEMBER",
    });
  }
  return pulls;
}

export function makeCommits(n: number, repoId: number, opts?: { baseTs?: number }): unknown[] {
  const baseTs = opts?.baseTs ?? Date.parse("2026-04-10T00:00:00Z");
  const commits: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const ts = new Date(baseTs - i * 60_000).toISOString();
    commits.push({
      sha: sha(repoId, i, "c"),
      commit: {
        message: `commit ${i}`,
        author: { name: "dev", email: "dev@example.com", date: ts },
      },
      author: { login: `dev${i % 5}` },
    });
  }
  return commits;
}

function sha(repoId: number, i: number, tag: string): string {
  const hex = `${repoId.toString(16).padStart(6, "0")}${i.toString(16).padStart(6, "0")}${tag}`;
  return `${hex}abcdef0123456789`.slice(0, 40);
}
