import "server-only";
import type { Ctx } from "@bematist/api";
import { headers } from "next/headers";
import { getDbClients } from "./db";

/**
 * Resolve the current-request `Ctx` from the Better Auth session cookie.
 *
 * M1 status: Walid's Better Auth hookup lives in `apps/ingest` and is not yet
 * wired through to `apps/web`. Until it is, we synthesize a dev-only Ctx in
 * local mode so the dashboard renders end-to-end. The real implementation
 * reads the session cookie, validates it, and populates tenant/actor/role.
 *
 * Import path — apps/web pages, Server Actions, and Route Handlers call this.
 * Never call from client components (marked `server-only`).
 */
export async function getSessionCtx(): Promise<Ctx> {
  // Touch headers() so the caller participates in Next.js's dynamic-rendering
  // bookkeeping — prevents accidental static caching of auth-scoped pages.
  await headers();

  if (process.env.NODE_ENV !== "production") {
    return {
      tenant_id: "dev-tenant",
      actor_id: "dev-actor",
      role: "admin",
      db: getDbClients(),
    };
  }

  // TODO(B4 / Walid): validate Better Auth session cookie, derive tenant_id
  // from org membership, pick RBAC role from `users.role`, attach reveal_token
  // from the `reveal:<token>` Redis key when the request header carries one.
  throw new Error(
    "getSessionCtx: auth not yet wired in production — blocked on apps/ingest Better Auth handoff",
  );
}

/**
 * Reveal-token-aware variant used by session detail routes. Pulls the token
 * from the `x-reveal-token` header (set client-side after a successful reveal
 * mutation) and stitches it onto the ctx.
 */
export async function getRevealedCtx(): Promise<Ctx> {
  const hs = await headers();
  const token = hs.get("x-reveal-token");
  const ctx = await getSessionCtx();
  // exactOptionalPropertyTypes — avoid writing `undefined` explicitly.
  return token ? { ...ctx, reveal_token: token } : ctx;
}
