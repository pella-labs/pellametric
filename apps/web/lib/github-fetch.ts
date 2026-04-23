/**
 * Shared GitHub REST request headers. Callers stay on raw `fetch`; this
 * only consolidates the 3-line `{ Authorization, Accept, User-Agent }`
 * block that appears in every GitHub call. Pass `undefined` for unauth
 * requests (which accept the 60/hr/IP public quota).
 */
export function githubHeaders(token?: string): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "pellametric",
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}
