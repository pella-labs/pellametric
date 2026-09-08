// Insights revamp (P21): membership-required middleware for insights APIs.
// Returns the authoritative session + membership row, or a 403 Response.
// All cohort/insights endpoints must call this; never return 404 to mask
// auth — that leaks org existence.

import { headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { membership, org } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export type Membership = typeof membership.$inferSelect;
export type Org = typeof org.$inferSelect;

export type AuthedMembership = {
  userId: string;
  membership: Membership;
  org: Org;
};

/**
 * Verifies the requester has membership in `orgSlug`. Returns the membership +
 * org row, or a Response (403) the caller should return immediately.
 *
 * `requiredRole` defaults to any; pass `"manager"` to scope to manager-only.
 */
export async function requireMembership(
  orgSlug: string,
  opts: { provider?: string; requiredRole?: "manager" | "dev" } = {},
): Promise<AuthedMembership | Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const provider = opts.provider ?? "github";
  const orgRow = await db.query.org.findFirst({
    where: and(eq(org.slug, orgSlug), eq(org.provider, provider)),
  });
  if (!orgRow) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  const mem = await db.query.membership.findFirst({
    where: and(eq(membership.userId, session.user.id), eq(membership.orgId, orgRow.id)),
  });
  if (!mem) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  if (opts.requiredRole && mem.role !== opts.requiredRole) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return { userId: session.user.id, membership: mem, org: orgRow };
}

/**
 * Internal-API gate. Accepts current OR previous secret (quarterly rotation).
 *
 * H7 fix: compare with timingSafeEqual after a length pre-check. The previous
 * `===` comparison short-circuits character-by-character and leaks the secret
 * length and per-byte mismatch timing.
 */
export function checkInternalSecret(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/.exec(auth);
  if (!m) return false;
  const got = m[1];
  const cur = process.env.INTERNAL_API_SECRET ?? "";
  const prev = process.env.INTERNAL_API_SECRET_PREVIOUS ?? "";
  if (!cur && !prev) return false;
  return safeMatch(got, cur) || safeMatch(got, prev);
}

function safeMatch(a: string, b: string): boolean {
  if (b.length === 0) return false;
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
