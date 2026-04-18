import { NextResponse } from "next/server";
import { hasStarred } from "@/lib/github-stars";

/**
 * Check whether a GitHub username has starred the bematist repo.
 *
 * We paginate through the repo's public stargazers list instead of hitting
 * /users/{user}/starred/{owner}/{repo}, because the latter returns 404 when
 * the user has toggled "private stars" on their profile. Stargazers on a
 * public repo are always public, regardless of the user's privacy setting.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const username = url.searchParams.get("username");

  if (!username || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(username)) {
    return NextResponse.json({ error: "invalid username" }, { status: 400 });
  }

  const result = await hasStarred(username);
  if (result.ok) return NextResponse.json({ starred: result.starred });
  return NextResponse.json({ error: result.error }, { status: result.status });
}
