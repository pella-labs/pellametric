import "server-only";
import type { Ctx } from "@bematist/api";
import { cookies, headers } from "next/headers";
import { getDbClients } from "./db";
import {
  BETTER_AUTH_COOKIE_NAME,
  resolveSessionCtx,
  SESSION_COOKIE_NAME,
} from "./session-resolver";

/**
 * Resolve the current-request `Ctx` from the Better Auth session cookie,
 * `BEMATIST_DEV_TENANT_ID` env pin, or non-prod deterministic fallback.
 * See `./session-resolver` for the decision tree.
 *
 * Called from every RSC page, Server Action, and Route Handler that lives
 * behind an authenticated boundary. `server-only` keeps this out of any
 * client bundle.
 */
export async function getSessionCtx(): Promise<Ctx> {
  // Touch headers() so the caller participates in Next.js's dynamic-rendering
  // bookkeeping — prevents accidental static caching of auth-scoped pages.
  const hs = await headers();
  const ck = await cookies();
  const db = getDbClients();

  // Better Auth sets `better-auth.session_token` on successful OAuth.
  // Separate from the legacy `bematist-session` Redis shim so the M4 path
  // (PG-backed session row) and the pre-M4 path (Redis-backed) can coexist
  // without interfering with each other's tests.
  return resolveSessionCtx({
    sessionCookie: ck.get(SESSION_COOKIE_NAME)?.value ?? null,
    betterAuthCookie: ck.get(BETTER_AUTH_COOKIE_NAME)?.value ?? null,
    revealHeader: hs.get("x-reveal-token"),
    env: process.env,
    redis: db.redis,
    db,
  });
}

/**
 * Reveal-token-aware variant — retained for callers that explicitly distinguish
 * reveal paths. `getSessionCtx` already stitches the reveal token on when the
 * header is present, so this is effectively an alias; kept for API stability
 * with existing route handlers.
 */
export async function getRevealedCtx(): Promise<Ctx> {
  return getSessionCtx();
}

export { DEV_ACTOR_ID_FALLBACK, DEV_TENANT_ID_FALLBACK } from "./session-resolver";
