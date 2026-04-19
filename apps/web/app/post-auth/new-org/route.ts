import { randomBytes } from "node:crypto";
import { createIngestKey } from "@bematist/api";
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { getDbClients } from "@/lib/db";
import { type UpgradeDeps, type UpgradeResult, upgradeToNewOrg } from "@/lib/upgrade-to-new-org";
import {
  sealWelcomeBearer,
  WELCOME_BEARER_COOKIE_NAME,
  WELCOME_BEARER_COOKIE_PATH,
  WELCOME_BEARER_COOKIE_TTL_S,
} from "@/lib/welcome-bearer-cookie";

/**
 * Post-auth upgrade: the authenticated user (bridged into the shared
 * `default` org as `role=ic` by `apps/web/lib/auth-bridge.ts`) is promoted
 * into their own brand-new org as `role=admin`, gets a `developers` row,
 * and has a fresh ingest key minted. Plaintext bearer is sealed into an
 * HttpOnly signed cookie for `/welcome` to read once.
 *
 * This is the "Sign up with GitHub" branch of the M4 onboarding flow.
 * Landing page links to `/auth/sign-in?intent=new-org`; the sign-in client
 * passes `callbackURL=/post-auth/new-org` so Better Auth drops a freshly
 * authenticated user here after OAuth.
 *
 * Idempotent: a user who is already out of `default` (because they came
 * through this route once already, or were invited into another org) is
 * redirected to `/welcome` without minting a second key. `/welcome` in
 * that no-bearer-cookie case shows "view in /admin/ingest-keys".
 *
 * Runtime: Node (default). Uses `@clickhouse/client` and `pg` transitively.
 * Force dynamic — never static.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? "dev-only-change-in-prod";

export async function GET(req: Request) {
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session?.user) {
    // No session → bounce back to sign-in. The ?intent=new-org param
    // preserves the signup branch so they land here again after OAuth.
    return NextResponse.redirect(absoluteUrl(req, "/auth/sign-in?intent=new-org"));
  }

  const db = getDbClients();
  const betterAuthUserId = session.user.id;

  // Resolve our internal `users` row. The Better Auth `user.create.after`
  // hook already bridged this on first OAuth — we just need id + org + email.
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
    // Bridge-hook timing issue: Better Auth identity exists but our `users`
    // row wasn't written yet. Surface an explicit error rather than silently
    // creating a duplicate — operators will notice.
    return NextResponse.json(
      {
        error:
          "No matching users row for this Better Auth identity. Sign out and sign back in; if this persists, contact your admin.",
      },
      { status: 500 },
    );
  }

  // GitHub login drives the org slug base. We pull it from the stored
  // provider account so we don't need to re-hit api.github.com here —
  // Better Auth's `account_id` is the numeric GitHub user id; the login
  // is not stored directly, so we mirror what card/token does: optional
  // fetch, fallback to email local-part on failure.
  const githubLogin = await resolveGithubLogin(db, betterAuthUserId);

  const upgradeDeps = buildUpgradeDeps(db);
  let upgrade: UpgradeResult;
  try {
    upgrade = await upgradeToNewOrg(upgradeDeps, {
      userId: user.id,
      githubLogin,
      email: user.email,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        level: "error",
        module: "web/post-auth/new-org",
        msg: "upgradeToNewOrg failed",
        err: msg,
      }),
    );
    return NextResponse.json({ error: "Upgrade failed. Try again." }, { status: 500 });
  }

  // Already-upgraded path: no fresh bearer to hand to /welcome. Redirect
  // with no cookie; /welcome falls through to "view in /admin/ingest-keys".
  if (upgrade.action === "already_upgraded") {
    return NextResponse.redirect(absoluteUrl(req, "/welcome"));
  }

  // New-org path: mint the first ingest key bound to the new developer row.
  // Call `createIngestKey` directly with an admin Ctx — the user IS admin now.
  if (!upgrade.developerId) {
    // Defensive: branch 3 of upgradeToNewOrg always returns a developerId.
    return NextResponse.json({ error: "Developer row missing; cannot mint key." }, { status: 500 });
  }

  const adminCtx = {
    tenant_id: upgrade.orgId,
    actor_id: upgrade.userId,
    role: "admin" as const,
    db,
  };

  let minted: Awaited<ReturnType<typeof createIngestKey>>;
  try {
    minted = await createIngestKey(adminCtx, {
      engineer_id: upgrade.developerId,
      name: "First key",
      tier_default: "B",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        level: "error",
        module: "web/post-auth/new-org",
        msg: "createIngestKey failed",
        err: msg,
      }),
    );
    // Org + developer are already written; redirect to /welcome without a
    // bearer cookie so the user can mint one manually from /admin.
    return NextResponse.redirect(absoluteUrl(req, "/welcome"));
  }

  const cookieValue = sealWelcomeBearer(
    {
      bearer: minted.bearer,
      keyId: minted.id,
      orgSlug: upgrade.slug,
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

/**
 * Resolve the signed-in user's GitHub login. Mirrors the `card/token`
 * route's pattern: read `account_id` from `better_auth_account`, fetch
 * `api.github.com/user/{id}` to convert to login. Failures return null —
 * the upgrade falls back to the email local-part for the slug base.
 */
async function resolveGithubLogin(
  db: ReturnType<typeof getDbClients>,
  betterAuthUserId: string,
): Promise<string | null> {
  const rows = await db.pg.query<{ account_id: string }>(
    `SELECT account_id FROM better_auth_account
     WHERE user_id = $1 AND provider_id = 'github'
     LIMIT 1`,
    [betterAuthUserId],
  );
  const accountId = rows[0]?.account_id;
  if (!accountId) return null;
  try {
    const res = await fetch(`https://api.github.com/user/${accountId}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "bematist-new-org-flow",
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
 * Wire `upgradeToNewOrg` deps to the real Postgres client. Slug-collision
 * retry lives here: we try up to 5 times with a fresh random suffix before
 * giving up and surfacing the unique-constraint error to the user.
 */
function buildUpgradeDeps(db: ReturnType<typeof getDbClients>): UpgradeDeps {
  return {
    getDefaultOrgSlug: async () => "default",
    findUserById: async (id) => {
      const rows = await db.pg.query<{
        id: string;
        org_id: string;
        role: string;
        email: string;
      }>(`SELECT id, org_id, role, email FROM users WHERE id = $1 LIMIT 1`, [id]);
      const r = rows[0];
      return r ? { id: r.id, orgId: r.org_id, role: r.role, email: r.email } : null;
    },
    getOrgSlugById: async (orgId) => {
      const rows = await db.pg.query<{ slug: string }>(
        `SELECT slug FROM orgs WHERE id = $1 LIMIT 1`,
        [orgId],
      );
      return rows[0]?.slug ?? null;
    },
    createOrg: async ({ slugBase, name }) => {
      // Retry on slug collision with a fresh suffix. `slugBase` already has
      // one suffix burned in by the pure logic; add a second random segment
      // on collision.
      let candidate = slugBase;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const rows = await db.pg.query<{ id: string; slug: string }>(
            `INSERT INTO orgs (slug, name)
             VALUES ($1, $2)
             RETURNING id, slug`,
            [candidate, name],
          );
          const r = rows[0];
          if (r) return { orgId: r.id, slug: r.slug };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Postgres unique-constraint error code is 23505. postgres-js puts
          // it in `.code`; we can't reliably type-narrow so we test the
          // message as a fallback.
          const isUnique =
            (err as { code?: string })?.code === "23505" || /duplicate key/i.test(msg);
          if (!isUnique) throw err;
          const extra = randomBytes(2).toString("hex");
          candidate = `${slugBase}${extra}`;
        }
      }
      throw new Error("createOrg: exhausted slug retries");
    },
    promoteUserToNewOrg: async ({ userId, newOrgId }) => {
      await db.pg.query(`UPDATE users SET org_id = $1, role = 'admin' WHERE id = $2`, [
        newOrgId,
        userId,
      ]);
    },
    createDeveloperRow: async ({ orgId, userId, stableHash }) => {
      const rows = await db.pg.query<{ id: string }>(
        `INSERT INTO developers (org_id, user_id, stable_hash)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [orgId, userId, stableHash],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error("createDeveloperRow: insert returned no row");
      return id;
    },
    randomSuffix: () => {
      // 6 hex chars ≈ 24 bits of entropy; enough that a collision on a
      // popular login (e.g. `octocat<suffix>`) is unlikely in practice.
      return randomBytes(3).toString("hex");
    },
  };
}
