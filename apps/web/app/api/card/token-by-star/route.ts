import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { hashCardToken, isReservedCardSlug, toCardSlug } from "@/lib/card-backend";
import { hasStarred } from "@/lib/github-stars";
import { mintCardToken } from "@/lib/card-token-mint";

export const dynamic = "force-dynamic";

/**
 * POST /api/card/token-by-star — star-gated token issuance. If the supplied
 * GitHub username has publicly starred pella-labs/pellametric, mint a
 * one-shot card token tied to that login. No sign-in required.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { username?: string } | null;
    const username = body?.username?.trim();

    if (!username || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(username)) {
      return NextResponse.json({ error: "invalid username" }, { status: 400 });
    }

    const check = await hasStarred(username);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    if (!check.starred) return NextResponse.json({ error: "not_starred" }, { status: 400 });

    const slug = toCardSlug(username);
    if (isReservedCardSlug(slug)) {
      return NextResponse.json(
        { error: `GitHub username '${username}' collides with a reserved path.` },
        { status: 400 },
      );
    }

    const token = mintCardToken();
    const tokenHash = hashCardToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await sql`
      INSERT INTO card_tokens (token_hash, subject_kind, subject_id, github_username, expires_at)
      VALUES (${tokenHash}, 'github_star', ${slug}, ${username}, ${expiresAt}::timestamptz)`;
    return NextResponse.json({ token });
  } catch (e) {
    console.error("[/api/card/token-by-star] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
