import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { REPO } from "@/lib/github-stars";
import { apiError } from "@/lib/api/error";
import { withAuth } from "@/lib/api/with-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/card/star-repo — star pella-labs/pellametric on behalf of the
 * signed-in user using their stored GitHub access_token. Requires the
 * `public_repo` (or `repo`) OAuth scope.
 */
export const POST = withAuth(async (_req, { userId }) => {
  try {
    const [acc] = await db
      .select()
      .from(schema.account)
      .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "github")))
      .limit(1);
    const accessToken = acc?.accessToken;
    if (!accessToken) return apiError("GitHub token unavailable");

    const ghRes = await fetch(`https://api.github.com/user/starred/${REPO.owner}/${REPO.name}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "Content-Length": "0",
        "User-Agent": "pellametric-card-flow",
      },
    });

    // 204 = starred, 304 = already starred, 404 = scope missing.
    if (ghRes.status === 204 || ghRes.status === 304) return NextResponse.json({ starred: true });
    return NextResponse.json(
      { starred: false, status: ghRes.status },
      { status: ghRes.status === 404 ? 403 : 502 },
    );
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Internal error", undefined, 500);
  }
});
