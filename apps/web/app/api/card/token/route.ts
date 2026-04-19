import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { hashCardToken, isReservedCardSlug, toCardSlug } from "@/lib/card-backend";
import { getDbClients } from "@/lib/db";

const adjectives = [
  "swift",
  "cosmic",
  "neon",
  "lunar",
  "pixel",
  "turbo",
  "hyper",
  "cyber",
  "nova",
  "quantum",
  "stellar",
  "arcane",
  "blazing",
  "shadow",
  "golden",
  "iron",
  "chrome",
  "electric",
  "frozen",
  "silent",
];
const nouns = [
  "falcon",
  "phoenix",
  "coder",
  "spark",
  "orbit",
  "pulse",
  "forge",
  "nexus",
  "cipher",
  "vortex",
  "prism",
  "atlas",
  "titan",
  "raven",
  "storm",
  "byte",
  "flux",
  "drift",
  "echo",
  "blade",
];

function mintPlainToken(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  const hex = randomBytes(8).toString("hex");
  return `bm_${adj}-${noun}-${num}-${hex}`;
}

/**
 * Resolve the signed-in user's GitHub login from Better Auth's stored
 * provider account. GitHub's OAuth callback populates
 * `better_auth_account.account_id` with the numeric user id; we hit the
 * public `api.github.com/user/{id}` endpoint once to convert that to a
 * login, which becomes the denormalized `github_username` on the card.
 */
async function resolveGithubUsernameForUser(userId: string): Promise<string | null> {
  const { pg } = getDbClients();
  const rows = await pg.query<{ account_id: string }>(
    `SELECT account_id FROM better_auth_account
     WHERE user_id = $1 AND provider_id = 'github'
     LIMIT 1`,
    [userId],
  );
  const accountId = rows[0]?.account_id;
  if (!accountId) return null;
  try {
    const res = await fetch(`https://api.github.com/user/${accountId}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "bematist-card-flow",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { login?: string };
    return data.login ?? null;
  } catch {
    return null;
  }
}

/**
 * POST /api/card/token — mint a one-shot, 1h-TTL bearer token for the
 * signed-in user. The grammata CLI trades it at `/api/card/submit` for
 * a permanent card URL.
 *
 * Auth: Better Auth session cookie. 401 if unauthenticated.
 */
export async function POST(req: Request) {
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Pretty URLs require a resolvable GitHub login: /card/<slug> IS the
  // username (lowercased). Fail the mint if we can't resolve — better to
  // surface a clean error than to issue a token the submit step can't
  // turn into a valid card_id.
  const githubUsername = await resolveGithubUsernameForUser(session.user.id);
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

  const token = mintPlainToken();
  const tokenHash = hashCardToken(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  const { pg } = getDbClients();
  await pg.query(
    `INSERT INTO card_tokens (token_hash, subject_kind, subject_id, github_username, expires_at)
     VALUES ($1, 'better_auth_user', $2, $3, $4)`,
    [tokenHash, slug, githubUsername, expiresAt],
  );
  return NextResponse.json({ token });
}
