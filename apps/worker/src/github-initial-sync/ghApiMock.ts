// Test-only in-process GitHub API mock for the initial-sync worker.
//
// Why: we can't hit real GitHub in CI, and adding `nock`/`msw` would need a
// dep review (see task brief). This is a zero-dep shim: it implements the
// `fetch`-compatible signature and satisfies the exact subset of the GitHub
// REST API the initial-sync paginator touches:
//   GET /installation/repositories?page=N&per_page=100
//
// It honors `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers so the
// pause-and-resume invariant can be asserted without a real rate-limit hit.

export interface MockRepo {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  archived?: boolean;
}

/** Per-page override — lets a test force a specific remaining/reset. */
export interface PageOverride {
  /** If set, overrides the `X-RateLimit-Remaining` header on THIS page. */
  rateLimitRemaining?: number;
  /** If set, overrides `X-RateLimit-Reset` (epoch seconds). */
  rateLimitResetEpochSec?: number;
  /** If set, returns this HTTP status instead of 200 (use for 429/secondary). */
  status?: number;
  /** If status is 429, optional `Retry-After` seconds. */
  retryAfterSec?: number;
}

export interface MockApiOpts {
  repos: MockRepo[];
  perPage?: number; // default 100
  /** Per-1-indexed-page overrides. */
  pageOverrides?: Record<number, PageOverride>;
  /** Called on every request — lets tests observe which pages were hit. */
  onRequest?: (info: { url: string; page: number; at: number }) => void;
  /** Mutable clock the mock uses to write `X-RateLimit-Reset`. */
  clock?: () => number;
}

export interface MockApi {
  fetch: typeof fetch;
  /** Number of real API requests made so far (excluding 429s counted too). */
  readonly requestCount: number;
  /** One entry per request in order. */
  readonly history: Array<{ url: string; page: number; at: number }>;
}

export function createMockGitHubApi(opts: MockApiOpts): MockApi {
  const perPage = opts.perPage ?? 100;
  const clock = opts.clock ?? (() => Date.now());
  const history: Array<{ url: string; page: number; at: number }> = [];

  const fetchFn = (async (input: string | URL | Request, _init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const u = new URL(url);
    const page = Number(u.searchParams.get("page") ?? "1");
    const entry = { url, page, at: clock() };
    history.push(entry);
    opts.onRequest?.(entry);

    const override = opts.pageOverrides?.[page];

    // 429 / secondary — short-circuit.
    if (override?.status && override.status !== 200) {
      const headers = new Headers({
        "content-type": "application/json",
      });
      if (override.retryAfterSec !== undefined) {
        headers.set("retry-after", String(override.retryAfterSec));
      }
      return new Response(JSON.stringify({ message: "rate limited" }), {
        status: override.status,
        headers,
      });
    }

    const start = (page - 1) * perPage;
    const end = start + perPage;
    const slice = opts.repos.slice(start, end);
    // GitHub's `/installation/repositories` shape:
    //   { total_count: number, repositories: Repo[] }
    const body = {
      total_count: opts.repos.length,
      repositories: slice,
    };
    const totalPages = Math.max(1, Math.ceil(opts.repos.length / perPage));
    const links: string[] = [];
    if (page < totalPages) {
      links.push(
        `<https://api.github.com/installation/repositories?page=${page + 1}&per_page=${perPage}>; rel="next"`,
      );
      links.push(
        `<https://api.github.com/installation/repositories?page=${totalPages}&per_page=${perPage}>; rel="last"`,
      );
    }
    if (page > 1) {
      links.push(
        `<https://api.github.com/installation/repositories?page=${page - 1}&per_page=${perPage}>; rel="prev"`,
      );
      links.push(
        `<https://api.github.com/installation/repositories?page=1&per_page=${perPage}>; rel="first"`,
      );
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

    return new Response(JSON.stringify(body), {
      status: 200,
      headers,
    });
  }) as typeof fetch;

  return Object.defineProperties({ fetch: fetchFn } as MockApi, {
    requestCount: { get: () => history.length, enumerable: true },
    history: { get: () => history, enumerable: true },
  });
}
