import { z } from "zod";

/**
 * M4 PR 3 — admin ingest-key minting + listing + revoke.
 *
 * Bearer format is LOCKED to 3-segment `bm_<orgSlug>_<keyId>_<secret>` (see
 * `apps/ingest/src/auth/verifyIngestKey.ts` + `contracts/02-ingest-api.md`).
 * Only the sha256 of `<secret>` is ever persisted; plaintext round-trips once
 * through the UI on the mint-response screen and is never stored.
 *
 * `engineer_id` is nullable on the row so org-level "shared" keys still work
 * (e.g. CI bots) — the admin UI currently forces a pick but the schema stays
 * permissive to match the existing PG column.
 */

/** Tier mirrors `packages/schema/postgres/schema.ts#ingestKeys.tier_default`. */
export const IngestKeyTier = z.enum(["A", "B", "C"]);
export type IngestKeyTier = z.infer<typeof IngestKeyTier>;

// --- list ------------------------------------------------------------

export const ListIngestKeysInput = z.object({
  /** `false` (default) hides revoked keys; `true` surfaces them too. */
  include_revoked: z.boolean().default(false),
});
export type ListIngestKeysInput = z.input<typeof ListIngestKeysInput>;

export const IngestKeyListItem = z.object({
  /** The `<keyId>` segment — NOT the bearer's secret. Safe to render. */
  id: z.string(),
  /** The first ~12 chars of the bearer prefix `bm_<orgSlug>_<keyId>_…` for
   *  visual identification on the list page. The trailing secret is never
   *  stored and can't be reconstructed. */
  prefix: z.string(),
  /** Human label set at mint time. */
  name: z.string(),
  /** Developer this key is pinned to (UUID into `developers.id`) — `null`
   *  means the key is org-scoped / shared (CI bots, etc.). */
  engineer_id: z.string().uuid().nullable(),
  /** Denormalized email of the developer's `users` row for display. */
  engineer_email: z.string().nullable(),
  tier_default: IngestKeyTier,
  created_at: z.string().datetime(),
  /** Null until revoked. */
  revoked_at: z.string().datetime().nullable(),
  /** Informational. Populated from the 60s verifier LRU when available; null
   *  if the key has never been used or the last-used projection hasn't been
   *  written yet. Nice-to-have, not load-bearing. */
  last_used_at: z.string().datetime().nullable(),
});
export type IngestKeyListItem = z.infer<typeof IngestKeyListItem>;

export const ListIngestKeysOutput = z.object({
  keys: z.array(IngestKeyListItem),
});
export type ListIngestKeysOutput = z.infer<typeof ListIngestKeysOutput>;

// --- create ----------------------------------------------------------

export const CreateIngestKeyInput = z.object({
  /** Developer to pin this key to. MUST belong to the caller's org — verified
   *  server-side in the query layer; UI-level check is advisory only. */
  engineer_id: z.string().uuid(),
  /** Short label. Max 128 for UI overflow sanity. */
  name: z.string().trim().min(1).max(128),
  /** Default tier. B per D7 (works-council compatible). Admin can flip to
   *  A (counters only) at mint time; C is gated by tenant-wide signed config
   *  AND managed-cloud opt-in — NOT settable from this form. */
  tier_default: z.enum(["A", "B"]).default("B"),
});
export type CreateIngestKeyInput = z.input<typeof CreateIngestKeyInput>;

export const CreateIngestKeyOutput = z.object({
  /** Server-generated `<keyId>` segment (alphanumeric, 12 chars). */
  id: z.string(),
  /** The ONLY time the plaintext bearer is returned. Display once, copy,
   *  discard. Never stored; never logged. */
  bearer: z.string(),
  name: z.string(),
  engineer_id: z.string().uuid(),
  tier_default: IngestKeyTier,
  created_at: z.string().datetime(),
});
export type CreateIngestKeyOutput = z.infer<typeof CreateIngestKeyOutput>;

// --- revoke ----------------------------------------------------------

export const RevokeIngestKeyInput = z.object({
  id: z.string().min(1).max(64),
});
export type RevokeIngestKeyInput = z.input<typeof RevokeIngestKeyInput>;

export const RevokeIngestKeyOutput = z.object({
  id: z.string(),
  revoked_at: z.string().datetime(),
});
export type RevokeIngestKeyOutput = z.infer<typeof RevokeIngestKeyOutput>;

// --- developer picker ------------------------------------------------

export const ListOrgDevelopersInput = z.object({});
export type ListOrgDevelopersInput = z.input<typeof ListOrgDevelopersInput>;

export const OrgDeveloper = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  email: z.string(),
  stable_hash: z.string(),
});
export type OrgDeveloper = z.infer<typeof OrgDeveloper>;

export const ListOrgDevelopersOutput = z.object({
  developers: z.array(OrgDeveloper),
});
export type ListOrgDevelopersOutput = z.infer<typeof ListOrgDevelopersOutput>;
