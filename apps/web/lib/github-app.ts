// GitHub App auth: mint short-lived JWTs from the app's private key, exchange them
// for installation tokens, and call the GitHub API as the installation. Tokens are
// cached in-process until ~5 min before expiry so we don't hit the JWT exchange on
// every request. Reads GITHUB_APP_ID / GITHUB_APP_CLIENT_ID and GITHUB_APP_PRIVATE_KEY
// from env. Use Client ID per GitHub's current guidance; falls back to App ID.

import { createSign } from "node:crypto";

type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<number, CachedToken>();
const SAFETY_WINDOW_MS = 5 * 60 * 1000;

function appIssuer(): string {
  return process.env.GITHUB_APP_CLIENT_ID || process.env.GITHUB_APP_ID || "";
}

function privateKeyPem(): string {
  const raw = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!raw) throw new Error("GITHUB_APP_PRIVATE_KEY is not set");
  // Railway preserves newlines, but if someone pastes the key with literal \n
  // in a one-liner, normalize it.
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signAppJwt(): string {
  const iss = appIssuer();
  if (!iss) throw new Error("GITHUB_APP_CLIENT_ID or GITHUB_APP_ID must be set");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss };
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(data);
  signer.end();
  const sig = signer.sign(privateKeyPem());
  return `${data}.${base64url(sig)}`;
}

export async function installationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - SAFETY_WINDOW_MS > Date.now()) return cached.token;

  const jwt = signAppJwt();
  const r = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`installation token exchange failed (${r.status}): ${body}`);
  }
  const data = (await r.json()) as { token: string; expires_at: string };
  const expiresAt = new Date(data.expires_at).getTime();
  tokenCache.set(installationId, { token: data.token, expiresAt });
  return data.token;
}

export async function appFetch(installationId: number, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await installationToken(installationId);
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

export async function getInstallation(installationId: number): Promise<{
  id: number;
  account: { id: number; login: string; type: string } | null;
} | null> {
  const jwt = signAppJwt();
  const r = await fetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!r.ok) return null;
  return r.json();
}

export function appConfigured(): boolean {
  return !!(privateKeyOk() && appIssuer());
}

function privateKeyOk(): boolean {
  try { privateKeyPem(); return true; } catch { return false; }
}

export function installUrl(orgSlug: string): string {
  const slug = process.env.GITHUB_APP_SLUG;
  if (!slug) return "";
  // `state` is echoed back by GitHub in the post-install redirect; we use it to
  // route the user back to the right org page after install completes.
  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(orgSlug)}`;
}
