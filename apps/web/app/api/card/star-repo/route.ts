import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { getDbClients } from "@/lib/db";

/**
 * POST /api/card/star-repo — star pella-labs/bematist on behalf of the
 * signed-in user. The GitHub access_token is stored server-side in
 * `better_auth_account.access_token` by Better Auth; the star goes out
 * from here rather than the browser.
 *
 * Requires the `public_repo` scope on the GitHub provider (set in
 * `apps/web/lib/auth.ts`). Safe to retry — starring an already-starred
 * repo is a 204 no-op on GitHub's side.
 */
const OWNER = "pella-labs";
const REPO = "bematist";

export async function POST(req: Request) {
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { pg } = getDbClients();
  const rows = await pg.query<{ access_token: string | null }>(
    `SELECT access_token FROM better_auth_account
      WHERE user_id = $1 AND provider_id = 'github'
      LIMIT 1`,
    [session.user.id],
  );
  const accessToken = rows[0]?.access_token;
  if (!accessToken) {
    return NextResponse.json({ error: "GitHub token unavailable" }, { status: 400 });
  }

  const ghRes = await fetch(`https://api.github.com/user/starred/${OWNER}/${REPO}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "Content-Length": "0",
      "User-Agent": "bematist-card-flow",
    },
  });

  // GitHub returns 204 on success, 304 on already-starred, 404 when the
  // token lacks `public_repo`. All three are "effectively starred" or
  // "user can retry manually"; surface the status but don't crash the flow.
  if (ghRes.status === 204 || ghRes.status === 304) {
    return NextResponse.json({ starred: true });
  }
  return NextResponse.json(
    { starred: false, status: ghRes.status },
    { status: ghRes.status === 404 ? 403 : 502 },
  );
}
