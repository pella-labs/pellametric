// Installation-token cache for the GitHub App (Sprint-1 Phase 6, D-S1-16).
// In-memory only; production deployments get the same shape backed by Redis
// in Sprint 2. Minimal: cache hit → reuse; miss/expired → mint App-JWT,
// POST /app/installations/:id/access_tokens, parse expires_at, cache with
// 60s safety margin.

import { mintAppJwt } from "./jwt";

export interface InstallationTokenCache {
  get(installationId: string): Promise<string | null>;
  set(installationId: string, token: string, ttlMs: number): void;
}

interface Entry {
  token: string;
  expiresAt: number;
}

export function createInMemoryInstallationTokenCache(
  opts: { clock?: () => number } = {},
): InstallationTokenCache {
  const clock = opts.clock ?? (() => Date.now());
  const map = new Map<string, Entry>();
  return {
    async get(installationId) {
      const hit = map.get(installationId);
      if (!hit) return null;
      if (hit.expiresAt <= clock()) {
        map.delete(installationId);
        return null;
      }
      return hit.token;
    },
    set(installationId, token, ttlMs) {
      map.set(installationId, { token, expiresAt: clock() + ttlMs });
    },
  };
}

export type FetchFn = typeof fetch;

export interface GetInstallationTokenInput {
  installationId: string;
  appId: string | number;
  privateKeyPem: string;
  cache: InstallationTokenCache;
  fetchFn?: FetchFn;
  /** Override GitHub API origin for tests. */
  apiBase?: string;
  /** Clock injection; defaults to Date.now. */
  now?: () => number;
}

/**
 * Resolve an installation token. Cache hit → return cached. Otherwise mint
 * App-JWT, POST /app/installations/:id/access_tokens, parse expires_at,
 * cache with a 60s safety margin.
 */
export async function getInstallationToken(input: GetInstallationTokenInput): Promise<string> {
  const { installationId, appId, privateKeyPem, cache } = input;
  const cached = await cache.get(installationId);
  if (cached) return cached;

  const doFetch = input.fetchFn ?? fetch;
  const apiBase = input.apiBase ?? "https://api.github.com";
  const now = input.now ?? Date.now;
  const appJwt = mintAppJwt({ appId, privateKeyPem, now });
  const res = await doFetch(
    `${apiBase}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${appJwt}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    throw new Error(`github-app:install-token-failed:${res.status}`);
  }
  const body = (await res.json()) as { token?: string; expires_at?: string };
  if (!body.token || !body.expires_at) {
    throw new Error("github-app:install-token-malformed");
  }
  const expiresAtMs = Date.parse(body.expires_at);
  const ttlMs = Math.max(60_000, expiresAtMs - now() - 60_000);
  cache.set(installationId, body.token, ttlMs);
  return body.token;
}
