import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

/**
 * Better Auth catch-all handler for `/api/auth/*` (M4 PR 1).
 *
 * Exposes every Better Auth endpoint — `sign-in/social`, `callback/:provider`,
 * `sign-out`, `session`, `verify-email`, etc. — behind `/api/auth`. The
 * sign-in page (`app/auth/sign-in/page.tsx`) POSTs to these routes via
 * `authClient.signIn.social({ provider: "github" })`.
 *
 * Runtime: Node (default). Better Auth uses `node-postgres` transitively
 * through our Drizzle adapter, which isn't edge-safe, so we rely on Next's
 * default Node runtime here.
 *
 * Force dynamic: these routes must never be statically cached — every
 * request must hit the OAuth flow / cookie-set code path.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = toNextJsHandler(getAuth());

export const GET = handler.GET;
export const POST = handler.POST;
