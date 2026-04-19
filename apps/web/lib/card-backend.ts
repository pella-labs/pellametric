import { createHash } from "node:crypto";

/**
 * SHA-256 of a card bearer token. The plain token is shown to the user once;
 * only this hash is stored in `card_tokens.token_hash`. Must be identical
 * between mint (`/api/card/token`, `/api/card/token-by-star`) and consume
 * (`/api/card/submit`) — do not inline-hash in routes.
 */
export function hashCardToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Slugs we refuse to mint a card for — each is either an existing route
 * under `/card/*` (demo) or a path we might want to claim later. Checked
 * case-insensitively at token mint time (both OAuth and star-gate paths)
 * so a stranger can't grab `/card/api` just because their GitHub login
 * happens to be `api`.
 */
const RESERVED_CARD_SLUGS = new Set([
  "demo",
  "new",
  "me",
  "api",
  "auth",
  "admin",
  "card",
  "home",
  "install",
  "privacy",
  "settings",
]);

export function isReservedCardSlug(slug: string): boolean {
  return RESERVED_CARD_SLUGS.has(slug.toLowerCase());
}

/**
 * GitHub logins are case-insensitive and unique — the public profile URL
 * `github.com/<login>` resolves regardless of case. We lowercase at mint
 * time so a given user always lands on the same slug and the primary-key
 * conflict semantics on `cards.card_id` work.
 */
export function toCardSlug(githubUsername: string): string {
  return githubUsername.toLowerCase();
}
