import { z } from "zod";

/**
 * M4 PR 4 — org_invites admin CRUD + invitee accept.
 *
 * Flow:
 *   1. Admin hits `/admin/invites` → calls `createInvite` → gets a URL.
 *   2. Invitee visits `/join/<token>` → sees org name + role → clicks sign-in.
 *   3. After GitHub OAuth, Better Auth's bridge hook lands them in the
 *      "default" org as role=ic (see `apps/web/lib/auth-bridge.ts`). The
 *      Better Auth `callbackURL` is `/post-auth/accept-invite?token=<token>`,
 *      which calls `acceptInviteByToken` to UPGRADE the user into the invite's
 *      target org at the invite's pinned role.
 *   4. The accept-invite route mints an ingest key for the new developer and
 *      hands it off to `/welcome` via a one-time cookie.
 *
 * Token format: `randomBytes(32).toString('base64url')` — 43 URL-safe chars,
 * 256 bits of entropy. Opaque; never encodes the org_id. Lookup is O(1) via
 * the unique btree index on `org_invites.token`.
 */

// --- shared role enum (mirrors `org_invites.role` default 'ic') ---
// The underlying column is free-text; we constrain to the same values the
// auth-bridge already recognizes so a role string that rides through an
// invite is guaranteed to be one the session resolver understands.
export const InviteRole = z.enum(["admin", "ic"]);
export type InviteRole = z.infer<typeof InviteRole>;

// --- create ---------------------------------------------------------

export const CreateInviteInput = z.object({
  /** Role the invitee will be assigned on acceptance. Default `ic`. */
  role: InviteRole.default("ic"),
  /** Expiry in days. Default 14 (matches the PG default). Max 90 to keep
   *  an unused token from lingering indefinitely. */
  expires_in_days: z.number().int().min(1).max(90).default(14),
});
export type CreateInviteInput = z.input<typeof CreateInviteInput>;

export const CreateInviteOutput = z.object({
  id: z.string().uuid(),
  /** The opaque token — appears in the URL. Base64url, 43 chars. */
  token: z.string().min(32).max(64),
  /** Full share URL: `${BETTER_AUTH_URL}/join/${token}`. */
  url: z.string().url(),
  role: InviteRole,
  expires_at: z.string().datetime(),
  created_at: z.string().datetime(),
});
export type CreateInviteOutput = z.infer<typeof CreateInviteOutput>;

// --- list -----------------------------------------------------------

export const ListInvitesInput = z.object({
  /** `false` (default) hides revoked + accepted; `true` surfaces everything. */
  include_inactive: z.boolean().default(false),
});
export type ListInvitesInput = z.input<typeof ListInvitesInput>;

export const InviteListItem = z.object({
  id: z.string().uuid(),
  /** First 8 chars of the token for visual correlation. The full token is
   *  never re-shown after creation — admins who lost it revoke + re-create. */
  token_prefix: z.string(),
  role: InviteRole,
  created_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  accepted_at: z.string().datetime().nullable(),
  /** Email of the accepting user, if any (for audit readability). */
  accepted_by_email: z.string().nullable(),
  revoked_at: z.string().datetime().nullable(),
  /** Derived convenience field: "active" | "accepted" | "revoked" | "expired". */
  status: z.enum(["active", "accepted", "revoked", "expired"]),
});
export type InviteListItem = z.infer<typeof InviteListItem>;

export const ListInvitesOutput = z.object({
  invites: z.array(InviteListItem),
});
export type ListInvitesOutput = z.infer<typeof ListInvitesOutput>;

// --- revoke ---------------------------------------------------------

export const RevokeInviteInput = z.object({
  id: z.string().uuid(),
});
export type RevokeInviteInput = z.input<typeof RevokeInviteInput>;

export const RevokeInviteOutput = z.object({
  id: z.string().uuid(),
  revoked_at: z.string().datetime(),
});
export type RevokeInviteOutput = z.infer<typeof RevokeInviteOutput>;

// --- accept ---------------------------------------------------------
//
// Accept takes a free-form string token (no zod parse on the hot path — the
// route handler hands it in as-is) and a Better Auth-derived `userId`/`email`.
// Not admin-gated because the invitee is mid-signup and starts in the default
// org (see `auth-bridge.ts` — first user lands as `ic` in `default`).

export interface AcceptInviteInput {
  token: string;
  userId: string;
  userEmail: string;
}

export type AcceptInviteError = "not_found" | "expired" | "revoked" | "already_accepted";

export type AcceptInviteResult =
  | {
      ok: true;
      invite_id: string;
      org_id: string;
      org_slug: string;
      org_name: string;
      role: InviteRole;
      /** Developer row id (new or existing) for the invitee in the target org.
       *  Used downstream to mint an ingest key. */
      developer_id: string;
      /** True when the user was already in this org (e.g. a double-click). */
      already_in_org: boolean;
    }
  | { ok: false; error: AcceptInviteError };

// --- preview (public, unauthenticated) ------------------------------
//
// Used by `/join/<token>` to show the invitee what they're accepting BEFORE
// signing in. Returns just the safe-to-surface metadata; never leaks
// `created_by` identity or counts of other invites.

export interface GetInvitePreviewInput {
  token: string;
}

export type GetInvitePreviewResult =
  | {
      ok: true;
      org_name: string;
      role: InviteRole;
      expires_at: string;
    }
  | { ok: false; error: AcceptInviteError };
