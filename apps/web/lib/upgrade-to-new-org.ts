// Pure logic that takes a freshly-bridged user (currently sitting in the
// shared `default` org as role=ic) and upgrades them into their own brand
// new org as role=admin with a matching `developers` row. No Next.js,
// no `server-only`, no raw Postgres — deps are injected so `bun test`
// can exercise the branch-by-branch logic without a live DB.
//
// This is the "new-org upgrade" half of the signup spine. The bridge in
// `./auth-bridge.ts` intentionally never promotes anyone to admin on
// sign-in (D30 threat: stranger-admin privilege escalation via the /card
// marketing-surface OAuth). Upgrade happens explicitly after the user
// clicks "Sign up with GitHub" on the landing page and is redirected
// through `/post-auth/new-org` — so the promotion is a deliberate user
// action, not a side-effect of OAuth ordering.
//
// Idempotency: calling the upgrade twice for a user who is already out
// of the `default` org is a no-op — we return the current (orgId, role)
// so the caller can render /welcome without creating a second org.

export interface UpgradeDeps {
  /** Slug of the shared `default` org. Users only upgrade out of this one. */
  getDefaultOrgSlug: () => Promise<string>;
  /**
   * Current user row keyed by Better Auth id. Drives the
   * already-upgraded-idempotency branch.
   */
  findUserById: (userId: string) => Promise<{
    id: string;
    orgId: string;
    role: string;
    email: string;
  } | null>;
  /**
   * Resolve an org's slug by id — used to detect "is this user in the
   * default org or did they already upgrade". `null` if the row was
   * deleted between operations (treat as already-upgraded, fail-safe).
   */
  getOrgSlugById: (orgId: string) => Promise<string | null>;
  /**
   * Reserve a fresh `orgs.slug`. Implementations should retry up to a
   * small limit with increasing random suffix on unique-constraint
   * violation. Returns the final slug + org id.
   */
  createOrg: (params: {
    slugBase: string;
    name: string;
  }) => Promise<{ orgId: string; slug: string }>;
  /** Point `users.org_id` at the new org and set `role='admin'`. */
  promoteUserToNewOrg: (params: { userId: string; newOrgId: string }) => Promise<void>;
  /**
   * Create the `developers` row for the promoted user in the new org. A
   * developers row is needed so `createIngestKey` can bind to an
   * `engineer_id`. `stable_hash` matches the D1-05 seed pattern:
   * `eng_<orgSlug>_<userIdShort>`.
   */
  createDeveloperRow: (params: {
    orgId: string;
    userId: string;
    stableHash: string;
  }) => Promise<string>;
  /**
   * Short random suffix generator. Injected so tests can make it
   * deterministic. Return value MUST be alphanumeric — bearers derived
   * from this slug flow through the ingest verifier's alphanumeric
   * regex (see `packages/api/src/queries/ingestKeys.ts#resolveOrgSlug`).
   */
  randomSuffix: () => string;
}

export interface UpgradeInput {
  /** Our internal `users.id`, not the Better Auth id. */
  userId: string;
  /** GitHub login — drives the slug base. Lowercased + sanitized. */
  githubLogin: string | null;
  /** For the fallback slug base when githubLogin is missing. */
  email: string;
}

export interface UpgradeResult {
  action: "already_upgraded" | "created_new_org";
  userId: string;
  orgId: string;
  developerId: string | null;
  slug: string;
  role: "admin" | "ic";
}

/**
 * Promote a user currently in the `default` org into their own brand-new
 * org as `role=admin`.
 *
 * Three branches:
 *
 *   1. User row missing → throw. Caller decides to redirect back to
 *      sign-in. This is a bug shape — the bridge should have created a
 *      row during OAuth — but we surface it rather than silently create.
 *   2. User is NOT in the default org → idempotent no-op. Returns the
 *      current (orgId, role) so the caller can render /welcome with
 *      their existing ingest key (minted by a prior upgrade call).
 *   3. User is in the default org → create a new org with a slug derived
 *      from `githubLogin` + `randomSuffix()`, point the user's `org_id`
 *      at it, set role=admin, create the developer row. `developerId`
 *      is returned so the caller can mint the first ingest key.
 *
 * `slugBase` derivation: lowercase `githubLogin`, strip anything that
 * isn't `[a-z0-9]`, fall back to the local-part of email on empty.
 * `randomSuffix()` is appended with a dash — wait, no: dashes break the
 * ingest-bearer verifier regex. The suffix is appended as plain
 * lowercase alphanumeric so the full slug matches `^[A-Za-z0-9]+$`.
 */
export async function upgradeToNewOrg(
  deps: UpgradeDeps,
  input: UpgradeInput,
): Promise<UpgradeResult> {
  const user = await deps.findUserById(input.userId);
  if (!user) {
    throw new Error(`upgradeToNewOrg: user ${input.userId} not found`);
  }

  const defaultSlug = await deps.getDefaultOrgSlug();
  const currentSlug = await deps.getOrgSlugById(user.orgId);

  // Branch 2: already upgraded — not in default anymore. Idempotent pass-through.
  if (currentSlug !== null && currentSlug !== defaultSlug) {
    return {
      action: "already_upgraded",
      userId: user.id,
      orgId: user.orgId,
      developerId: null,
      slug: currentSlug,
      role: normalizeRole(user.role),
    };
  }

  // Branch 3: in default → promote.
  const slugBase = deriveSlugBase(input.githubLogin, input.email);
  const suffix = sanitizeSuffix(deps.randomSuffix());
  const { orgId: newOrgId, slug } = await deps.createOrg({
    slugBase: `${slugBase}${suffix}`,
    name: deriveOrgName(input.githubLogin, input.email),
  });

  await deps.promoteUserToNewOrg({
    userId: user.id,
    newOrgId,
  });

  const developerId = await deps.createDeveloperRow({
    orgId: newOrgId,
    userId: user.id,
    stableHash: `eng_${slug}_${user.id.slice(0, 8)}`,
  });

  return {
    action: "created_new_org",
    userId: user.id,
    orgId: newOrgId,
    developerId,
    slug,
    role: "admin",
  };
}

function deriveSlugBase(githubLogin: string | null, email: string): string {
  const fromLogin = (githubLogin ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromLogin.length > 0) return fromLogin.slice(0, 20);
  const localPart = email.split("@")[0] ?? "";
  const fromEmail = localPart.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromEmail.length > 0) return fromEmail.slice(0, 20);
  return "user";
}

function deriveOrgName(githubLogin: string | null, email: string): string {
  if (githubLogin && githubLogin.trim().length > 0) return `${githubLogin}'s team`;
  const localPart = email.split("@")[0] ?? "user";
  return `${localPart}'s team`;
}

function sanitizeSuffix(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return cleaned.length > 0 ? cleaned : "x";
}

function normalizeRole(role: string): "admin" | "ic" {
  return role === "admin" ? "admin" : "ic";
}
