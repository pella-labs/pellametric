"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Better Auth client for the dashboard sign-in page. Client-component-only
 * (uses `use client`) since it calls into `window.fetch` under the hood.
 *
 * Base URL: relative to the current origin. The dashboard and the API live
 * on the same host (Next.js monolith), so no cross-origin config is needed.
 */
// biome-ignore lint/suspicious/noExplicitAny: better-auth's inferred client type references an internal .mjs path that isn't portable; typing loosely avoids TS2742 while preserving runtime behaviour.
export const authClient: any = createAuthClient({
  // Explicit empty-string base URL means "same origin as the page". Setting
  // it explicitly shuts up the upstream warning about unspecified baseURL.
  baseURL: typeof window !== "undefined" ? window.location.origin : "",
});

export const { signIn, signOut, useSession } = authClient;
