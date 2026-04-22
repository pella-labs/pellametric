/**
 * GitHub star verification. Paginates public stargazers of
 * pella-labs/pellametric and checks if a login is present (case-insensitive).
 * Uses stargazers (not per-user starred endpoint) so users with private
 * stars in their profile still verify. Rate-limited by GitHub's unauth
 * quota (60/hr/IP) unless GITHUB_TOKEN is set.
 */

const REPO_OWNER = "pella-labs";
const REPO_NAME = "pellametric";
const PER_PAGE = 100;
const MAX_PAGES = 50;

type Result = { ok: true; starred: boolean } | { ok: false; error: string; status: number };

export async function hasStarred(username: string): Promise<Result> {
  const needle = username.toLowerCase();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/stargazers?per_page=${PER_PAGE}&page=${page}`;
    let res: Response;
    try {
      res = await fetch(url, { headers, cache: "no-store" });
    } catch {
      return { ok: false, error: "github unreachable", status: 502 };
    }
    if (res.status === 403) return { ok: false, error: "github rate limit, please retry later", status: 429 };
    if (res.status === 404) return { ok: false, error: "repo not found", status: 502 };
    if (!res.ok) return { ok: false, error: `github returned ${res.status}`, status: 502 };

    const rows = (await res.json().catch(() => [])) as Array<{ login?: string }>;
    if (!Array.isArray(rows) || rows.length === 0) return { ok: true, starred: false };
    for (const r of rows) {
      if (r.login && r.login.toLowerCase() === needle) return { ok: true, starred: true };
    }
    if (rows.length < PER_PAGE) return { ok: true, starred: false };
  }
  return { ok: true, starred: false };
}

export const REPO = { owner: REPO_OWNER, name: REPO_NAME };
