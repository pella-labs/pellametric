import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db, schema, sql } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { hashCardToken, isReservedCardSlug, toCardSlug } from "@/lib/card-backend";
import { mintCardToken } from "@/lib/card-token-mint";

export const dynamic = "force-dynamic";

/**
 * POST /api/card/token — mint a one-shot, 1h-TTL bearer token for the
 * signed-in user. The collector/CLI trades it at `/api/card/submit`.
 */
export async function POST() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    // Prefer stashed user.githubLogin; fall back to account.accountId
    // (numeric GitHub user id) → /user/{id} → login.
    let githubUsername = (session.user.githubLogin as string | null | undefined) ?? null;
    if (!githubUsername) {
      const [acc] = await db
        .select()
        .from(schema.account)
        .where(and(eq(schema.account.userId, session.user.id), eq(schema.account.providerId, "github")))
        .limit(1);
      const accountId = acc?.accountId;
      if (accountId) {
        try {
          const r = await fetch(`https://api.github.com/user/${accountId}`, {
            headers: { Accept: "application/vnd.github+json", "User-Agent": "pellametric-card-flow" },
          });
          if (r.ok) {
            const j = (await r.json()) as { login?: string };
            githubUsername = j.login ?? null;
          }
        } catch {}
      }
    }
    if (!githubUsername) {
      return NextResponse.json(
        { error: "Could not resolve your GitHub username. Try signing out and back in." },
        { status: 400 },
      );
    }
    const slug = toCardSlug(githubUsername);
    if (isReservedCardSlug(slug)) {
      return NextResponse.json(
        { error: `GitHub username '${githubUsername}' collides with a reserved path.` },
        { status: 400 },
      );
    }

    const token = mintCardToken();
    const tokenHash = hashCardToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await sql`
      INSERT INTO card_tokens (token_hash, subject_kind, subject_id, github_username, expires_at)
      VALUES (${tokenHash}, 'better_auth_user', ${slug}, ${githubUsername}, ${expiresAt}::timestamptz)`;
    return NextResponse.json({ token });
  } catch (e) {
    console.error("[/api/card/token] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
