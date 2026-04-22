import { createHash } from "node:crypto";

/**
 * SHA-256 of a card bearer token. The plain token is shown to the user once;
 * only this hash is stored in `card_tokens.token_hash`. Must be identical
 * between mint and consume paths — do not inline-hash in routes.
 */
export function hashCardToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

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
  "dashboard",
  "org",
  "setup",
  "signin",
]);

export function isReservedCardSlug(slug: string): boolean {
  return RESERVED_CARD_SLUGS.has(slug.toLowerCase());
}

export function toCardSlug(githubUsername: string): string {
  return githubUsername.toLowerCase();
}
