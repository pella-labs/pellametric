import { acceptInviteByToken, createIngestKey } from "@bematist/api";
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { getDbClients } from "@/lib/db";
import {
  sealWelcomeBearer,
  WELCOME_BEARER_COOKIE_NAME,
  WELCOME_BEARER_COOKIE_PATH,
  WELCOME_BEARER_COOKIE_TTL_S,
} from "@/lib/welcome-bearer-cookie";

/**
 * Post-auth invite acceptance — the sibling of `/post-auth/new-org` for the
 * "I was invited" branch.
 *
 * Flow:
 *   1. Better Auth already landed the user in the shared `default` org as
 *      `role=ic` via the bridge hook.
 *   2. This route reads `?token=<token>` from the URL, validates lifecycle
 *      (revoked / expired / already accepted), and atomically moves the user
 *      into the invite's org at the invite's role. See
 *      `packages/api/src/queries/invites.ts#acceptInviteByToken`.
 *   3. Mints a fresh ingest key bound to the new developer row.
 *   4. Seals the bearer plaintext in the signed `bematist-welcome-bearer`
 *      cookie and redirects to `/welcome`, which reads + clears the cookie
 *      and shows the install one-liner.
 *
 * Errors never leak bearer fragments. Lifecycle errors (revoked / expired /
 * already_accepted / not_found) redirect to `/join/<token>?error=<code>` so
 * the public join page surfaces the same friendly message the pre-auth path
 * would have shown.
 *
 * Runtime: Node (Postgres + ClickHouse + Redis clients). Force dynamic.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "dev-only-change-in-prod";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  // Missing / empty token — redirect to sign-in with a soft error.
  if (!token) {
    return NextResponse.redirect(absoluteUrl(req, "/auth/sign-in"));
  }

  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session?.user) {
    // No session → bounce back to the join page so the invitee can click
    // "Continue with GitHub" again. Never strand the token — preserve it.
    return NextResponse.redirect(absoluteUrl(req, `/join/${encodeURIComponent(token)}`));
  }

  const db = getDbClients();
  const betterAuthUserId = session.user.id;

  // Resolve our internal `users` row. Better Auth's `user.create.after` hook
  // runs the bridge (`auth-bridge.ts`), so this row should exist on first
  // OAuth. Defensive null-check — surface an explicit error if not.
  const userRows = await db.pg.query<{
    id: string;
    org_id: string;
    role: string;
    email: string;
  }>(
    `SELECT id, org_id, role, email
     FROM users
     WHERE better_auth_user_id = $1
     LIMIT 1`,
    [betterAuthUserId],
  );
  const user = userRows[0];
  if (!user) {
    console.error(
      JSON.stringify({
        level: "error",
        module: "web/post-auth/accept-invite",
        msg: "no users row for Better Auth identity",
        betterAuthUserId,
      }),
    );
    return NextResponse.json(
      {
        error:
          "No matching users row for this Better Auth identity. Sign out and sign back in; if this persists, contact your admin.",
      },
      { status: 500 },
    );
  }

  // --- Accept the invite -------------------------------------------
  const accept = await acceptInviteByToken(
    { pg: db.pg },
    { token, userId: user.id, userEmail: user.email },
  );

  if (!accept.ok) {
    // Preserve the token so the user can retry or ask their admin for a new
    // one from the same URL. The join page surfaces the error variant.
    return NextResponse.redirect(
      absoluteUrl(req, `/join/${encodeURIComponent(token)}?error=${accept.error}`),
    );
  }

  // Idempotent path: user was already a member of the target org (e.g. they
  // double-clicked or the admin re-sent). No new key — let /welcome fall
  // through to "view in /admin/ingest-keys".
  if (accept.already_in_org) {
    return NextResponse.redirect(absoluteUrl(req, "/welcome"));
  }

  // --- Mint the first ingest key for the new developer -------------
  // The user has been flipped to the new org; they are now at `role=ic`
  // (or `role=admin` if the invite was admin-scoped). `createIngestKey`
  // requires `admin`; to let IC invitees walk away with a working key, we
  // mint under an admin Ctx here — the org is the invite's target, and
  // minting-for-self is implicitly authorized by the invite acceptance.
  //
  // The Ctx below is synthesized locally and never leaves this route.
  // It does NOT participate in the `getSessionCtx()` resolver chain.
  const adminCtx = {
    tenant_id: accept.org_id,
    actor_id: user.id,
    role: "admin" as const,
    db,
  };

  let minted: Awaited<ReturnType<typeof createIngestKey>>;
  try {
    minted = await createIngestKey(adminCtx, {
      engineer_id: accept.developer_id,
      name: "First key",
      tier_default: "B",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        level: "error",
        module: "web/post-auth/accept-invite",
        msg: "createIngestKey failed",
        err: msg,
      }),
    );
    // Invite is already accepted + user is in the new org. Redirect to
    // /welcome without a bearer cookie — they'll see "view in /admin".
    return NextResponse.redirect(absoluteUrl(req, "/welcome"));
  }

  const cookieValue = sealWelcomeBearer(
    {
      bearer: minted.bearer,
      keyId: minted.id,
      orgSlug: accept.org_slug,
    },
    BETTER_AUTH_SECRET,
  );

  const response = NextResponse.redirect(absoluteUrl(req, "/welcome"));
  response.cookies.set({
    name: WELCOME_BEARER_COOKIE_NAME,
    value: cookieValue,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: WELCOME_BEARER_COOKIE_PATH,
    maxAge: WELCOME_BEARER_COOKIE_TTL_S,
  });
  return response;
}

function absoluteUrl(req: Request, path: string): URL {
  return new URL(path, req.url);
}
