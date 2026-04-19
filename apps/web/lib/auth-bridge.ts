// Pure bridge logic between Better Auth's identity tables and our internal
// `users` table. No Next.js, no `server-only`, no raw Postgres — deps are
// passed in. Lives in its own module so `bun test` can exercise the
// first-user-admin promotion rule and the find-or-create branches without
// spinning up a DB.

export type BridgeRole = "admin" | "ic";

export interface BridgeDeps {
  /** Count of rows in `users` for the given org. Drives first-user-admin. */
  countUsersInOrg: (orgId: string) => Promise<number>;
  /** Lookup by Better Auth `user.id`. Returns null if not yet bridged. */
  findUserByBetterAuthId: (
    betterAuthUserId: string,
  ) => Promise<{ id: string; orgId: string; role: string } | null>;
  /** Lookup by email so pre-seeded invites (email-only row) can be claimed. */
  findUserByEmail: (email: string) => Promise<{
    id: string;
    orgId: string;
    role: string;
    betterAuthUserId: string | null;
  } | null>;
  /** Resolve the "default org" id; create one if none exists. */
  getOrCreateDefaultOrg: () => Promise<string>;
  /** Back-fill the FK when claiming a pre-seeded invite. */
  linkBetterAuthIdToUser: (userId: string, betterAuthUserId: string) => Promise<void>;
  /** Insert a fresh `users` row for a brand-new Better Auth identity. */
  createUser: (params: {
    orgId: string;
    ssoSubject: string;
    email: string;
    role: BridgeRole;
    betterAuthUserId: string;
  }) => Promise<string>;
}

export interface BridgeInput {
  betterAuthUserId: string;
  email: string;
}

export interface BridgeResult {
  action: "already_bridged" | "claimed_existing_invite" | "created_new_user";
  userId: string;
  orgId: string;
  role: BridgeRole;
}

/**
 * Bridge a fresh Better Auth identity to our internal `users` table.
 *
 * Three paths, priority-ordered:
 *
 *   1. `better_auth_user_id` is already linked → idempotent no-op; returns
 *      the existing `(userId, orgId, role)`. Runs on every sign-in via the
 *      Better Auth `databaseHooks.user.create.after` hook — but that hook
 *      only fires on user *creation*, not sign-in. So this is defensive.
 *   2. A `users` row with the same email exists but is unlinked (the
 *      pre-seeded invite path): link the Better Auth id and return the
 *      existing role. Lets operators invite teammates by pre-inserting a
 *      row like `INSERT INTO users (org_id, email, sso_subject)` ahead of
 *      time.
 *   3. Brand new user: create a fresh `users` row in the default org.
 *      First user in an org becomes `admin`; everyone else is `ic`. This
 *      is the "bootstrap" path the M4 plan names — no need for a separate
 *      admin seed script.
 *
 * `ssoSubject` is derived from `github:<betterAuthUserId>` so the value is
 * deterministic and namespaced by provider. If we later add another
 * provider, the prefix prevents cross-provider collisions on the unique
 * constraint.
 */
export async function bridgeBetterAuthUser(
  deps: BridgeDeps,
  input: BridgeInput,
): Promise<BridgeResult> {
  // Path 1: already bridged (defensive — the hook fires on create, not sign-in).
  const existing = await deps.findUserByBetterAuthId(input.betterAuthUserId);
  if (existing) {
    return {
      action: "already_bridged",
      userId: existing.id,
      orgId: existing.orgId,
      role: normalizeRole(existing.role),
    };
  }

  // Path 2: pre-seeded invite — a row with matching email exists but has no
  // Better Auth link yet. Claim it by setting the FK.
  const byEmail = await deps.findUserByEmail(input.email);
  if (byEmail && byEmail.betterAuthUserId === null) {
    await deps.linkBetterAuthIdToUser(byEmail.id, input.betterAuthUserId);
    return {
      action: "claimed_existing_invite",
      userId: byEmail.id,
      orgId: byEmail.orgId,
      role: normalizeRole(byEmail.role),
    };
  }

  // Path 3: brand new. Resolve default org, create the row as `ic`.
  //
  // We intentionally do NOT auto-promote the first user to admin. The /card
  // marketing surface funnels strangers into OAuth; on a fresh install the
  // first random stargazer would otherwise inherit tenant-admin rights.
  // Admin is now explicitly granted out-of-band (SQL, invite flow, or a
  // dedicated bootstrap script) — never by sign-in ordering.
  //
  // `countUsersInOrg` is no longer consulted in this path but remains on
  // `BridgeDeps` as a utility callers may want elsewhere.
  const orgId = await deps.getOrCreateDefaultOrg();
  const role: BridgeRole = "ic";
  const ssoSubject = `github:${input.betterAuthUserId}`;
  const userId = await deps.createUser({
    orgId,
    ssoSubject,
    email: input.email,
    role,
    betterAuthUserId: input.betterAuthUserId,
  });

  return {
    action: "created_new_user",
    userId,
    orgId,
    role,
  };
}

/**
 * Normalize the free-text `role` column into the `BridgeRole` union.
 * Anything unrecognized defaults to `ic` — defensive, never returns an
 * unexpected string.
 */
function normalizeRole(role: string): BridgeRole {
  return role === "admin" ? "admin" : "ic";
}
