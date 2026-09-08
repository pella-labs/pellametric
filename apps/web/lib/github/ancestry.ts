// Hot-path §4.4 — force-push ancestry check (verbatim).
// GitHub REST: GET /repos/{owner}/{repo}/compare/{before}...{after}
// Treat any non-200 response as "not an ancestor" so we conservatively
// wipe + rehydrate rather than silently dropping commits.

const ZERO_SHA = "0000000000000000000000000000000000000000";

export async function isAncestor(
  repo: string,
  before: string,
  after: string,
  token: string,
): Promise<boolean> {
  if (!before || before === ZERO_SHA) return false; // branch creation
  if (!after || after === ZERO_SHA) return false;   // branch deletion
  if (before === after) return true;

  const url = `https://api.github.com/repos/${repo}/compare/${before}...${after}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) return false;
  const body = (await res.json()) as { status?: string };
  return body.status === "ahead" || body.status === "identical";
}
