/**
 * GitHub star verification.
 *
 * Paginates the public stargazers list for pella-labs/bematist and checks if
 * a given login is present (case-insensitive). Uses stargazers (not the
 * per-user starred endpoint) so that users who have private stars enabled on
 * their profile still verify correctly — the per-user endpoint returns 404
 * for those users even when they've publicly starred the repo.
 *
 * Rate-limited by GitHub's unauthenticated quota (60/hr/IP) unless
 * GITHUB_TOKEN is set in the server environment.
 */

const REPO_OWNER = "pella-labs";
const REPO_NAME = "bematist";
const PER_PAGE = 100;
const MAX_PAGES = 50; // 5000 stars max before we give up and return false

type Result = { ok: true; starred: boolean } | { ok: false; error: string; status: number };

export async function hasStarred(username: string): Promise<Result> {
  const needle = username.toLowerCase();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/stargazers?per_page=${PER_PAGE}&page=${page}`;
    let res: Response;
    try {
      res = await fetch(url, { headers, cache: "no-store" });
    } catch {
      return { ok: false, error: "github unreachable", status: 502 };
    }
    if (res.status === 403) {
      return {
        ok: false,
        error: "github rate limit, please retry later",
        status: 429,
      };
    }
    if (res.status === 404) {
      return { ok: false, error: "repo not found", status: 502 };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: `github returned ${res.status}`,
        status: 502,
      };
    }
    const page_data = (await res.json().catch(() => [])) as Array<{
      login?: string;
    }>;
    if (!Array.isArray(page_data) || page_data.length === 0) {
      return { ok: true, starred: false };
    }
    if (page_data.some((u) => u.login?.toLowerCase() === needle)) {
      return { ok: true, starred: true };
    }
    if (page_data.length < PER_PAGE) {
      return { ok: true, starred: false };
    }
  }
  return { ok: true, starred: false };
}
