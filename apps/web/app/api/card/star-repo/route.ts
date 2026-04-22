import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { REPO } from "@/lib/github-stars";

export const dynamic = "force-dynamic";

/**
 * POST /api/card/star-repo — star pella-labs/pellametric on behalf of the
 * signed-in user using their stored GitHub access_token. Requires the
 * `public_repo` (or `repo`) OAuth scope.
 */
export async function POST() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const [acc] = await db
      .select()
      .from(schema.account)
      .where(and(eq(schema.account.userId, session.user.id), eq(schema.account.providerId, "github")))
      .limit(1);
    const accessToken = acc?.accessToken;
    if (!accessToken) return NextResponse.json({ error: "GitHub token unavailable" }, { status: 400 });

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
    console.error("[/api/card/star-repo] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
