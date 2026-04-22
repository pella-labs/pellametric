/**
 * Fetches the public `name` field from a GitHub user's profile. Used to
 * resolve a human-readable display name for the card flow. Uses
 * `GITHUB_TOKEN` if present to lift the unauth 60/hr/IP quota.
 */
export async function fetchGithubName(login: string | null | undefined): Promise<string | null> {
  if (!login) return null;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "pellametric-card-flow",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { name?: string | null } | null;
    const name = data?.name?.trim();
    return name ? name : null;
  } catch {
    return null;
  }
}
