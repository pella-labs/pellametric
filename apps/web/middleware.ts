import { type NextRequest, NextResponse } from "next/server";

/**
 * Middleware composes three orthogonal concerns — dashboard auth gating
 * (M4 PR 1), the `/` dashboard-vs-marketing rewrite (pre-M4), and a
 * logged-in redirect off `/auth/*`. Runs on the Edge runtime so we
 * CANNOT hit Postgres directly; we check auth state by cookie presence
 * only. The authoritative session validation happens in
 * `apps/web/lib/session.ts` via `getSessionCtx` — middleware just decides
 * whether to bounce to the sign-in page.
 *
 * Cookie-presence-only is a deliberate trade-off: it's defense-in-depth
 * (RSC pages re-check via `getSessionCtx`), cheap (no DB per request),
 * and edge-safe. A stolen-but-revoked cookie still gets a 401 on first
 * RSC render because the DB check catches it.
 */

const BETTER_AUTH_COOKIE_NAME = "better-auth.session_token";
const LEGACY_SESSION_COOKIE_NAME = "bematist-session";

/**
 * Paths that are always allowed for logged-out visitors. Everything else
 * under `/` that reaches middleware (after the matcher) redirects to
 * `/auth/sign-in` when no session cookie is present.
 */
const PUBLIC_PATH_PREFIXES = [
  "/auth/",
  "/api/auth/",
  "/api/",
  "/privacy",
  "/home",
  "/card",
  "/_next",
  "/favicon",
];

function isPublicPath(pathname: string): boolean {
  if (pathname === "/privacy" || pathname === "/home") return true;
  return PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

function hasSessionCookie(request: NextRequest): boolean {
  const ba = request.cookies.get(BETTER_AUTH_COOKIE_NAME)?.value;
  if (ba && ba.length > 0) return true;
  const legacy = request.cookies.get(LEGACY_SESSION_COOKIE_NAME)?.value;
  return Boolean(legacy && legacy.length > 0);
}

function isDevModeTenantPinned(): boolean {
  // The perf harness + local dev pins via `BEMATIST_DEV_TENANT_ID`. Treat
  // that as equivalent to "there will be a session" for middleware
  // purposes so the existing dev loop doesn't get bounced to sign-in.
  const pin = process.env.BEMATIST_DEV_TENANT_ID;
  return Boolean(pin && pin.length > 0);
}

function dashboardEnabled(): boolean {
  return process.env.DASHBOARD_ENABLED === "1" || process.env.NEXT_PUBLIC_DASHBOARD_ENABLED === "1";
}

function marketingMode(): boolean {
  return process.env.NEXT_PUBLIC_IS_CLOUD === "1" || process.env.VERCEL === "1";
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const loggedIn = hasSessionCookie(request) || isDevModeTenantPinned();

  // 1. `/` routing (preserves the pre-M4 dashboard-vs-marketing behaviour).
  if (pathname === "/") {
    if (dashboardEnabled()) {
      // Dashboard surface; fall through to the auth gate below.
    } else if (marketingMode()) {
      const url = request.nextUrl.clone();
      url.pathname = "/home";
      return NextResponse.rewrite(url);
    } else {
      // Plain `bun run dev` still shows the dashboard at `/`; tests hit this.
    }
  }

  // 2. Logged-in visitors bounce off `/auth/*` back to the dashboard.
  if (loggedIn && pathname.startsWith("/auth/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // 3. Logged-out visitors to auth-gated paths redirect to `/auth/sign-in`.
  if (!loggedIn && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    // Remember where they were headed — Better Auth's social callback
    // also accepts `callbackURL`, but we set it on the button. This
    // search param is a convenience for future handling.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Keep the same broad matcher as before but expand to cover the auth
  // routes. Skip `_next/*` and any file with a dot (static assets) so
  // middleware doesn't run per-request on every chunk.
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
