import { githubHeaders } from "@/lib/github-fetch";

/**
 * Fetches the public `name` field from a GitHub user's profile. Used to
 * resolve a human-readable display name for the card flow. Uses
 * `GITHUB_TOKEN` if present to lift the unauth 60/hr/IP quota.
 */
export async function fetchGithubName(login: string | null | undefined): Promise<string | null> {
  if (!login) return null;
  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
      headers: {
        ...githubHeaders(process.env.GITHUB_TOKEN),
        "X-GitHub-Api-Version": "2022-11-28",
      },
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
