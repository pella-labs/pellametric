// Pure session resolver — no `server-only`, no Next.js `headers()` / `cookies()`.
// Lives in its own file so `bun test` can exercise the branch-by-branch logic
// without going through Next's request scope. `session.ts` wraps this and adds
// the Next-specific request-extraction layer.

import { createHash } from "node:crypto";
import { AuthError, type Ctx, type PgClient, type RedisClient, type Role } from "@bematist/api";

export const DEV_TENANT_ID_FALLBACK = deterministicUuid("bematist:dev-tenant");
export const DEV_ACTOR_ID_FALLBACK = deterministicUuid("bematist:dev-actor");
export const SESSION_COOKIE_NAME = "bematist-session";
export const SESSION_REDIS_PREFIX = "auth:session:";
export const REVEAL_REDIS_PREFIX = "reveal:";
/**
 * Better Auth's default Next.js cookie name. Added in M4 PR 1 so the prod
 * path can also resolve sessions written by `better-auth` without going
 * through our legacy Redis shim. Name is stable for Better Auth 1.6.x; if
 * the upstream ever renames it, bump this pin.
 */
export const BETTER_AUTH_COOKIE_NAME = "better-auth.session_token";

interface SessionPayload {
  user_id: string;
  org_id: string;
  role: Role;
}

export interface ResolverDeps {
  sessionCookie: string | null;
  revealHeader: string | null;
  env: Readonly<Record<string, string | undefined>>;
  redis: RedisClient;
  db: Ctx["db"];
  /**
   * Optional: Better Auth session-cookie value pulled from
   * `better-auth.session_token`. When present, we look up the session row
   * via `pg` (Better Auth stores sessions server-side). Separate from
   * `sessionCookie` (the legacy `bematist-session` → Redis shim) so the
   * cookie-based tests stay stable.
   */
  betterAuthCookie?: string | null;
}

/**
 * Resolve a request-scoped `Ctx` from pre-extracted inputs. Four paths, in
 * priority order:
 *
 *   1. Better Auth cookie (`better-auth.session_token`) → PG lookup joins
 *      `better_auth_session` → `better_auth_user` → `users` to surface our
 *      tenant-scoped `org_id` + `role`. Added in M4 PR 1 when real signup
 *      landed; this is the prod path going forward.
 *   2. `bematist-session` cookie → Redis `auth:session:<token>` JSON
 *      `{ user_id, org_id, role }`. Legacy shim pre-dating Better Auth;
 *      retained so existing perf / integration harnesses that pre-seed
 *      Redis keep working.
 *   3. `BEMATIST_DEV_TENANT_ID` env → pin dashboard to a seeded org UUID.
 *   4. NODE_ENV !== "production" fallback → deterministic UUID derived from
 *      the literal `"dev-tenant"` so Postgres UUID casts succeed.
 *
 * Prod with no cookie and no env → throws `UNAUTHORIZED`.
 *
 * Reveal-token stitching (D30): if `x-reveal-token` header is present AND
 * `reveal:<token>` is alive in Redis, the returned Ctx carries `reveal_token`.
 * Invalid or expired tokens are silently dropped — they widen capability on
 * top of the base session, so absence falls back rather than fails.
 */
export async function resolveSessionCtx(deps: ResolverDeps): Promise<Ctx> {
  const reveal = await resolveRevealToken(deps.revealHeader, deps.redis);

  // Path 1 — Better Auth's own cookie + Postgres session row (prod).
  const fromBetterAuth = await resolveBetterAuthFromPg(deps.betterAuthCookie ?? null, deps.db.pg);
  if (fromBetterAuth) {
    return withReveal(
      {
        tenant_id: fromBetterAuth.org_id,
        actor_id: fromBetterAuth.user_id,
        role: fromBetterAuth.role,
        db: deps.db,
      },
      reveal,
    );
  }

  // Path 2 — legacy Redis-backed session cookie (pre-M4 perf harness).
  const fromCookie = await resolveBetterAuthSession(deps.sessionCookie, deps.redis);
  if (fromCookie) {
    return withReveal(
      {
        tenant_id: fromCookie.org_id,
        actor_id: fromCookie.user_id,
        role: fromCookie.role,
        db: deps.db,
      },
      reveal,
    );
  }

  const envTenant = deps.env.BEMATIST_DEV_TENANT_ID;
  if (envTenant && envTenant.length > 0) {
    return withReveal(
      {
        tenant_id: envTenant,
        actor_id: deps.env.BEMATIST_DEV_ACTOR_ID ?? DEV_ACTOR_ID_FALLBACK,
        role: (deps.env.BEMATIST_DEV_ROLE as Role | undefined) ?? "admin",
        db: deps.db,
      },
      reveal,
    );
  }

  if (deps.env.NODE_ENV === "production") {
    throw new AuthError(
      "UNAUTHORIZED",
      "getSessionCtx: no valid session cookie and no BEMATIST_DEV_TENANT_ID fallback.",
    );
  }

  return withReveal(
    {
      tenant_id: DEV_TENANT_ID_FALLBACK,
      actor_id: DEV_ACTOR_ID_FALLBACK,
      role: "admin",
      db: deps.db,
    },
    reveal,
  );
}

async function resolveBetterAuthSession(
  token: string | null,
  redis: RedisClient,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const raw = await redis.get(`${SESSION_REDIS_PREFIX}${token}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isSessionPayload(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Look up a Better Auth session straight from Postgres.
 *
 * Better Auth stores session rows in `better_auth_session` keyed on the
 * cookie value's `token` column; the Next.js cookie ships the token in its
 * signed form `<id>.<signature>`. Better Auth's own `auth.api.getSession`
 * handles the signature verification; here we re-query to join to our
 * internal `users` row (which has the org/role our dashboard cares about).
 *
 * Since the cookie value is signed and includes the base token as the prefix
 * before the dot, we split on `.` and take the first segment. If there is no
 * dot, we use the raw value (covers older/newer cookie formats). The session
 * row lookup then validates the token and we return null if it's absent or
 * expired — callers fall through to the next resolver path.
 *
 * Note: `users.better_auth_user_id` is nullable (so pre-Better-Auth seeded
 * rows keep working); if a session is live but no `users` row exists yet,
 * the `INNER JOIN` below omits the session and we fall through to UNAUTHORIZED
 * in prod. The Better Auth `databaseHooks.user.create.after` hook
 * back-fills `users` on first OAuth, so this null-join only happens for the
 * brief window between Better Auth user create and the hook firing.
 */
async function resolveBetterAuthFromPg(
  cookieValue: string | null,
  pg: PgClient,
): Promise<SessionPayload | null> {
  if (!cookieValue) return null;
  const token = cookieValue.includes(".") ? cookieValue.split(".")[0] : cookieValue;
  if (!token || token.length === 0) return null;
  const rows = await pg.query<{ id: string; org_id: string; role: string }>(
    `
      SELECT u.id, u.org_id, u.role
      FROM better_auth_session s
      JOIN users u ON u.better_auth_user_id = s.user_id
      WHERE s.token = $1
        AND s.expires_at > now()
      LIMIT 1
    `,
    [token],
  );
  const row = rows[0];
  if (!row) return null;
  const role = normalizePgRole(row.role);
  if (!role) return null;
  return { user_id: row.id, org_id: row.org_id, role };
}

/**
 * `users.role` is a free-text column; the dashboard's `Role` union is
 * tighter. Map the two common values explicitly and fall back to null so
 * the caller skips the session (safer than coercing to an unexpected role).
 */
function normalizePgRole(role: string): Role | null {
  switch (role) {
    case "admin":
      return "admin";
    case "manager":
      return "manager";
    case "engineer":
    case "ic":
      return "engineer";
    case "auditor":
      return "auditor";
    case "viewer":
      return "viewer";
    default:
      return null;
  }
}

async function resolveRevealToken(
  header: string | null,
  redis: RedisClient,
): Promise<string | null> {
  if (!header) return null;
  const alive = await redis.get(`${REVEAL_REDIS_PREFIX}${header}`);
  return alive ? header : null;
}

function withReveal(ctx: Ctx, revealToken: string | null): Ctx {
  // exactOptionalPropertyTypes — avoid writing `undefined` explicitly.
  return revealToken ? { ...ctx, reveal_token: revealToken } : ctx;
}

function isSessionPayload(x: unknown): x is SessionPayload {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.user_id !== "string" || o.user_id.length === 0) return false;
  if (typeof o.org_id !== "string" || o.org_id.length === 0) return false;
  if (typeof o.role !== "string") return false;
  const roles: readonly Role[] = ["admin", "manager", "engineer", "auditor", "viewer"];
  return (roles as readonly string[]).includes(o.role);
}

/**
 * Format a 16-byte digest as a RFC 9562 v8 ("custom") UUID — deterministic
 * hash of the input string. Used to turn the literal `"dev-tenant"` label into
 * a UUID Postgres accepts, so the dev fallback does not crash `teams.org_id`
 * casts. v8 is the experimental/vendor-custom variant; using it documents
 * that these UUIDs are synthesized, not random.
 */
function deterministicUuid(seed: string): string {
  const h = createHash("sha256").update(seed).digest();
  const bytes = Buffer.from(h.subarray(0, 16));
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x80, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
