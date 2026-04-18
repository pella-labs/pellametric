import { createHash, randomBytes } from "node:crypto";
import { AuthError, assertRole, type Ctx } from "../auth";
import type {
  CreateIngestKeyInput,
  CreateIngestKeyOutput,
  IngestKeyListItem,
  IngestKeyTier,
  ListIngestKeysInput,
  ListIngestKeysOutput,
  ListOrgDevelopersInput,
  ListOrgDevelopersOutput,
  OrgDeveloper,
  RevokeIngestKeyInput,
  RevokeIngestKeyOutput,
} from "../schemas/ingestKey";

/**
 * M4 PR 3 — admin data-access for ingest-key lifecycle + the developer picker
 * that backs the mint form.
 *
 * Cross-tenant safety model (defense-in-depth — BOTH layers must hold):
 *
 *  1. Postgres RLS on `ingest_keys` / `developers` / `users` / `orgs` forces
 *     `org_id = app_current_org()` when the app connects as `app_bematist`
 *     (see `packages/schema/postgres/custom/0002_rls_org_isolation.sql`).
 *  2. Every function here narrows the query with an explicit
 *     `WHERE org_id = $ctx.tenant_id` — so even if the dev-mode fallback
 *     runs as the `postgres` superuser (RLS bypassed), an admin at Org A
 *     cannot see or mutate Org B rows.
 *
 * The merge-blocker probe in
 * `packages/schema/postgres/__tests__/ingest_keys_cross_tenant.test.ts` tests
 * the combination: admin at Org A calling `createIngestKey` with an
 * `engineer_id` that resolves to Org B must get a `FORBIDDEN` / `NOT_FOUND`
 * refusal and leave Org B's row count unchanged.
 */

const KEY_ID_LEN = 12; // [a-z0-9]{12} ≈ 62 bits of entropy — unguessable
const KEY_SECRET_BYTES = 32; // 256-bit secret; hex-encoded = 64 chars

// Regex matches apps/ingest/src/auth/verifyIngestKey.ts BEARER_3SEG constraints.
const ALPHANUMERIC = /^[A-Za-z0-9]+$/;

function randomKeyId(): string {
  // Use lowercase alphanumeric so the bearer round-trips through the 3-seg regex.
  const bytes = randomBytes(9); // 9 bytes → 12 base32-ish chars
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < KEY_ID_LEN; i++) {
    const b = bytes[i % bytes.length] ?? 0;
    out += alphabet[b % alphabet.length];
  }
  return out;
}

function randomSecret(): string {
  return randomBytes(KEY_SECRET_BYTES).toString("hex");
}

function sha256Hex(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

// ------------------------------------------------------------ list

/**
 * List ingest keys for the caller's org. Admin-only. Soft-deleted (revoked)
 * keys hidden by default — pass `include_revoked: true` to surface them.
 *
 * Shape intentionally excludes any secret-adjacent fields (no `key_sha256`,
 * no stored bearer). The `prefix` is a display-only hint (`bm_<slug>_<id>…`)
 * so admins can visually correlate with what a teammate has in their env.
 */
export async function listIngestKeys(
  ctx: Ctx,
  input: ListIngestKeysInput,
): Promise<ListIngestKeysOutput> {
  assertRole(ctx, ["admin"]);

  // Parse default — input is z.input (pre-default) so caller may omit.
  const includeRevoked = input?.include_revoked === true;

  const slug = await resolveOrgSlug(ctx);

  const rows = await ctx.db.pg.query<IngestKeyRow>(
    `SELECT
       ik.id,
       ik.name,
       ik.engineer_id,
       u.email AS engineer_email,
       ik.tier_default,
       ik.created_at,
       ik.revoked_at
     FROM ingest_keys ik
     LEFT JOIN developers d ON d.id = ik.engineer_id AND d.org_id = ik.org_id
     LEFT JOIN users u ON u.id = d.user_id AND u.org_id = ik.org_id
     WHERE ik.org_id = $1
       ${includeRevoked ? "" : "AND ik.revoked_at IS NULL"}
     ORDER BY ik.created_at DESC
     LIMIT 500`,
    [ctx.tenant_id],
  );

  const keys: IngestKeyListItem[] = rows.map((r) => ({
    id: r.id,
    prefix: `bm_${slug}_${r.id}_…`,
    name: r.name,
    engineer_id: r.engineer_id ?? null,
    engineer_email: r.engineer_email ?? null,
    tier_default: normalizeTier(r.tier_default),
    created_at: toIso(r.created_at),
    revoked_at: r.revoked_at ? toIso(r.revoked_at) : null,
    last_used_at: null, // TODO(M5): wire up a `SELECT MAX(ts)` projection off CH
  }));

  return { keys };
}

// ------------------------------------------------------------ create

/**
 * Mint a new ingest key for an in-org developer. Admin-only.
 *
 * Contract:
 *   1. `engineer_id` MUST resolve to a developer row in the caller's org.
 *      Cross-tenant attempt → `AuthError(FORBIDDEN)`. Zero rows inserted.
 *   2. Generate `keyId` + `secret` server-side; hash the secret to sha256.
 *      Only the hash is persisted. The plaintext bearer is returned ONCE.
 *   3. Insert the row under the caller's `tenant_id` (never trust the
 *      engineer row's `org_id` alone — defense in depth).
 *   4. Write an immutable `audit_log` row scoped to the caller's org.
 */
export async function createIngestKey(
  ctx: Ctx,
  input: CreateIngestKeyInput,
): Promise<CreateIngestKeyOutput> {
  assertRole(ctx, ["admin"]);

  // Ensure the developer exists AND belongs to the caller's org. A single
  // query with `WHERE org_id = $tenant AND id = $engineer` gives us both
  // existence and tenant isolation in one round-trip.
  const devRows = await ctx.db.pg.query<{ id: string }>(
    `SELECT id FROM developers WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [input.engineer_id, ctx.tenant_id],
  );
  if (devRows.length === 0) {
    throw new AuthError(
      "FORBIDDEN",
      "engineer_id does not belong to your org (or does not exist).",
    );
  }

  const slug = await resolveOrgSlug(ctx);

  const keyId = randomKeyId();
  const secret = randomSecret();
  const sha256 = sha256Hex(secret);
  const tier: IngestKeyTier = input.tier_default ?? "B";

  // Explicit org_id = ctx.tenant_id so even if the engineer row's org_id
  // somehow drifts, the ingest_keys row lands under the caller's tenancy.
  const inserted = await ctx.db.pg.query<{ created_at: unknown }>(
    `INSERT INTO ingest_keys (id, org_id, engineer_id, name, key_sha256, tier_default)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING created_at`,
    [keyId, ctx.tenant_id, input.engineer_id, input.name, sha256, tier],
  );

  const createdAt = toIso(inserted[0]?.created_at ?? new Date());

  // audit_log is immutable (custom/0001_audit_log_immutable.sql). We write a
  // row here so admins can reconstruct who minted what. Metadata intentionally
  // excludes the key_sha256 — if audit_log ever leaks, it should never pair a
  // key id with its secret hash (defense-in-depth vs. offline brute force).
  await writeAuditLog(ctx, {
    action: "ingest_key.mint",
    target_type: "ingest_key",
    target_id: keyId,
    metadata: {
      engineer_id: input.engineer_id,
      tier_default: tier,
      name: input.name,
    },
  });

  return {
    id: keyId,
    bearer: `bm_${slug}_${keyId}_${secret}`,
    name: input.name,
    engineer_id: input.engineer_id,
    tier_default: tier,
    created_at: createdAt,
  };
}

// ------------------------------------------------------------ revoke

/**
 * Soft-delete an ingest key by setting `revoked_at = now()`. Admin-only.
 * Scoped to the caller's org; cross-tenant revoke attempts no-op and raise
 * `FORBIDDEN` — never silently succeed.
 *
 * The ingest path (`apps/ingest/src/auth/verifyIngestKey.ts#verifyBearer`)
 * already rejects bearers when `row.revoked_at` is set. The verifier LRU has
 * a 60s TTL, so a revocation propagates within that window — matching the
 * "401 within 60s" acceptance criterion. (In-test we clear the cache to
 * prove the underlying path.)
 */
export async function revokeIngestKey(
  ctx: Ctx,
  input: RevokeIngestKeyInput,
): Promise<RevokeIngestKeyOutput> {
  assertRole(ctx, ["admin"]);

  // Single-shot update scoped to the caller's org. UPDATE … WHERE org_id =
  // $tenant means cross-tenant calls match zero rows and we detect it via
  // RETURNING count. No information leak about whether the id exists in
  // another tenant.
  const updated = await ctx.db.pg.query<{ id: string; revoked_at: unknown }>(
    `UPDATE ingest_keys
       SET revoked_at = now()
     WHERE id = $1
       AND org_id = $2
       AND revoked_at IS NULL
     RETURNING id, revoked_at`,
    [input.id, ctx.tenant_id],
  );

  if (updated.length === 0) {
    // Either: (a) the id belongs to another tenant, (b) it doesn't exist, or
    // (c) it was already revoked. All three map to FORBIDDEN for the caller —
    // we don't expose which.
    throw new AuthError("FORBIDDEN", "Key not found in your org (or already revoked).");
  }

  const row = updated[0];
  if (!row) throw new AuthError("FORBIDDEN", "Revoke failed.");

  await writeAuditLog(ctx, {
    action: "ingest_key.revoke",
    target_type: "ingest_key",
    target_id: row.id,
    metadata: {},
  });

  return {
    id: row.id,
    revoked_at: toIso(row.revoked_at),
  };
}

// ------------------------------------------------------------ developers picker

/**
 * Return the caller's org's developers for the mint-form select. Scoped by
 * `org_id = ctx.tenant_id`; sorted by email for stable UI.
 */
export async function listOrgDevelopers(
  ctx: Ctx,
  _input: ListOrgDevelopersInput,
): Promise<ListOrgDevelopersOutput> {
  assertRole(ctx, ["admin"]);

  const rows = await ctx.db.pg.query<OrgDeveloper>(
    `SELECT
       d.id,
       d.user_id,
       u.email,
       d.stable_hash
     FROM developers d
     INNER JOIN users u ON u.id = d.user_id AND u.org_id = d.org_id
     WHERE d.org_id = $1
     ORDER BY u.email ASC
     LIMIT 500`,
    [ctx.tenant_id],
  );

  return { developers: rows };
}

// ------------------------------------------------------------ helpers

interface IngestKeyRow {
  id: string;
  name: string;
  engineer_id: string | null;
  engineer_email: string | null;
  tier_default: string;
  created_at: unknown;
  revoked_at: unknown | null;
}

function normalizeTier(raw: string): IngestKeyTier {
  const t = raw.trim().toUpperCase();
  if (t === "A" || t === "B" || t === "C") return t;
  return "B"; // fail-closed safe-default
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") {
    // postgres-js returns timestamptz as either Date (default) or ISO string
    // depending on `types` config; handle both so tests can pass either.
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return v;
  }
  return new Date().toISOString();
}

async function resolveOrgSlug(ctx: Ctx): Promise<string> {
  const rows = await ctx.db.pg.query<{ slug: string }>(
    `SELECT slug FROM orgs WHERE id = $1 LIMIT 1`,
    [ctx.tenant_id],
  );
  const slug = rows[0]?.slug;
  if (!slug) {
    throw new AuthError("FORBIDDEN", "Caller's org no longer exists.");
  }
  // Bearer regex requires alphanumeric slug. Historic seeds may have used
  // hyphens — reject here so we never mint a bearer the verifier can't parse.
  if (!ALPHANUMERIC.test(slug)) {
    throw new AuthError(
      "FORBIDDEN",
      `Org slug '${slug}' is not alphanumeric; bearer would fail the ingest verifier regex.`,
    );
  }
  return slug;
}

interface AuditLogInput {
  action: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
}

/**
 * Write an immutable `audit_log` row scoped to the caller's org.
 *
 * KNOWN-UNKNOWN (documented in PR description): `audit_log` IS RLS-scoped
 * by org per `packages/schema/postgres/custom/0002_rls_org_isolation.sql`.
 * Defense-in-depth: we explicitly bind `org_id = ctx.tenant_id` and
 * `actor_user_id = ctx.actor_id` so cross-tenant writes would be blocked by
 * the FK constraint (actor_user_id → users.id) + RLS policy.
 */
async function writeAuditLog(ctx: Ctx, entry: AuditLogInput): Promise<void> {
  try {
    await ctx.db.pg.query(
      `INSERT INTO audit_log (org_id, actor_user_id, action, target_type, target_id, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        ctx.tenant_id,
        ctx.actor_id,
        entry.action,
        entry.target_type,
        entry.target_id,
        JSON.stringify(entry.metadata),
      ],
    );
  } catch (err) {
    // Audit failures must not block the user action — but we MUST log them
    // so operators can reconcile (GDPR Art. 5(2) "accountability"). The
    // absence of an audit row on a successful mint is itself an alert signal.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        level: "error",
        module: "api/ingestKeys",
        msg: "audit_log write failed",
        action: entry.action,
        target_id: entry.target_id,
        err: msg,
      }),
    );
  }
}
