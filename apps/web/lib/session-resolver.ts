// Pure session resolver — no `server-only`, no Next.js `headers()` / `cookies()`.
// Lives in its own file so `bun test` can exercise the branch-by-branch logic
// without going through Next's request scope. `session.ts` wraps this and adds
// the Next-specific request-extraction layer.

import { createHash } from "node:crypto";
import { AuthError, type Ctx, type RedisClient, type Role } from "@bematist/api";

export const DEV_TENANT_ID_FALLBACK = deterministicUuid("bematist:dev-tenant");
export const DEV_ACTOR_ID_FALLBACK = deterministicUuid("bematist:dev-actor");
export const SESSION_COOKIE_NAME = "bematist-session";
export const SESSION_REDIS_PREFIX = "auth:session:";
export const REVEAL_REDIS_PREFIX = "reveal:";

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
}

/**
 * Resolve a request-scoped `Ctx` from pre-extracted inputs. Three paths, in
 * priority order:
 *
 *   1. `bematist-session` cookie → Redis `auth:session:<token>` JSON
 *      `{ user_id, org_id, role }`. Better Auth-compatible shape.
 *   2. `BEMATIST_DEV_TENANT_ID` env → pin dashboard to a seeded org UUID.
 *   3. NODE_ENV !== "production" fallback → deterministic UUID derived from
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
