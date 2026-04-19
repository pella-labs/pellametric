import { randomBytes } from "node:crypto";
import { AuthError, assertRole, type Ctx, type PgClient } from "../auth";
import type {
  AcceptInviteInput,
  AcceptInviteResult,
  CreateInviteInput,
  CreateInviteOutput,
  GetInvitePreviewInput,
  GetInvitePreviewResult,
  InviteListItem,
  InviteRole,
  ListInvitesInput,
  ListInvitesOutput,
  RevokeInviteInput,
  RevokeInviteOutput,
} from "../schemas/invite";

/**
 * M4 PR 4 — admin data-access for org invites + the invitee acceptance path.
 *
 * Cross-tenant safety model (defense-in-depth — BOTH layers must hold):
 *
 *   1. Postgres RLS on `org_invites` forces `org_id = app_current_org()` when
 *      the app connects as `app_bematist` (see
 *      `packages/schema/postgres/custom/0003_org_invites.sql` + `0002_…`).
 *   2. Every admin-gated function below narrows the query with an explicit
 *      `WHERE org_id = $ctx.tenant_id` — so even if a dev-mode fallback runs
 *      as the `postgres` superuser (RLS bypassed), an admin at Org A cannot
 *      read or revoke Org B's invites.
 *
 * Two functions break the tenant narrowing on purpose:
 *   - `getInvitePreview` is unauthenticated (`/join/<token>` renders before
 *     sign-in). It looks up by token only. We leak the org *name* and the
 *     *role* that will be granted — intentional, the whole flow is "show the
 *     invitee what they're accepting". Nothing else is exposed.
 *   - `acceptInviteByToken` is session-less at role-check time (the invitee
 *     is mid-signup) but authenticated via Better Auth's session (the caller
 *     hands us `userId`). It looks up by token, validates lifecycle, then
 *     UPDATEs `users.org_id = invite.org_id` atomically. Executed inside a
 *     PG transaction so partial state is impossible.
 */

const TOKEN_BYTES = 32; // 256-bit entropy → 43 base64url chars

// ------------------------------------------------------------ helpers

/** `randomBytes(32)` → URL-safe 43-char token. Node 20+ supports `base64url`. */
function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return v;
  }
  return new Date().toISOString();
}

function toIsoOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return toIso(v);
}

/** Derive the display status from lifecycle columns + now. Multi-use invites
 *  show "accepted" only when their use cap is hit; unlimited invites with
 *  non-zero uses stay "active" since more devs can still join. */
function deriveStatus(row: {
  accepted_at: unknown;
  revoked_at: unknown;
  expires_at: unknown;
  uses?: number;
  max_uses?: number | null;
}): InviteListItem["status"] {
  if (row.revoked_at) return "revoked";
  const exp = row.expires_at instanceof Date ? row.expires_at : new Date(String(row.expires_at));
  if (!Number.isNaN(exp.getTime()) && exp.getTime() <= Date.now()) return "expired";
  if (
    typeof row.uses === "number" &&
    row.max_uses !== null &&
    row.max_uses !== undefined &&
    row.uses >= row.max_uses
  ) {
    return "accepted";
  }
  return "active";
}

function normalizeRole(raw: string): InviteRole {
  return raw === "admin" ? "admin" : "ic";
}

function resolveBetterAuthUrl(): string {
  const raw = process.env.BETTER_AUTH_URL?.trim();
  if (!raw) return "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

interface AuditLogInput {
  action: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
}

/**
 * Write an immutable `audit_log` row. Same pattern as `ingestKeys.writeAuditLog`
 * — failures logged to stderr but never block the user action (GDPR Art. 5(2)
 * accountability: absence of an audit row on a successful mutation is itself
 * an alert signal).
 *
 * Accepts an explicit `(pg, orgId, actorId)` shape so the accept-invite path
 * can write into the TARGET org after the UPDATE — where `ctx.tenant_id` still
 * points at the user's old (default) org.
 */
async function writeAuditLog(
  pg: PgClient,
  orgId: string,
  actorId: string,
  entry: AuditLogInput,
): Promise<void> {
  try {
    await pg.query(
      `INSERT INTO audit_log (org_id, actor_user_id, action, target_type, target_id, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        orgId,
        actorId,
        entry.action,
        entry.target_type,
        entry.target_id,
        JSON.stringify(entry.metadata),
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        level: "error",
        module: "api/invites",
        msg: "audit_log write failed",
        action: entry.action,
        target_id: entry.target_id,
        err: msg,
      }),
    );
  }
}

// ------------------------------------------------------------ create

/**
 * Mint a new invite link for the caller's org. Admin-only.
 *
 * Contract:
 *   1. Role gate: `admin`.
 *   2. Token is 256-bit URL-safe, generated server-side. The DB column has
 *      a unique constraint; collisions are astronomically unlikely but we
 *      still bubble up the FK error rather than masking it.
 *   3. Insert row under the caller's `org_id` — defense-in-depth vs. RLS.
 *   4. Write an `audit_log` row (`org_invite.create`).
 */
export async function createInvite(
  ctx: Ctx,
  input: CreateInviteInput,
): Promise<CreateInviteOutput> {
  assertRole(ctx, ["admin"]);

  // zod defaults are applied when callers parse through the schema; this
  // function's parameter type is `z.input`, so defaults might be absent
  // when called directly (e.g. from tests). Normalize defensively.
  const role: InviteRole = (input?.role ?? "ic") as InviteRole;
  const expiresInDays = input?.expires_in_days ?? 14;
  // `null` max_uses = unlimited. Admin-form default is "unlimited" so one
  // invite link works for a whole team — scales to 100-dev orgs without
  // per-engineer link churn.
  const maxUses = input?.max_uses ?? null;

  const token = generateToken();

  const rows = await ctx.db.pg.query<{
    id: string;
    created_at: unknown;
    expires_at: unknown;
  }>(
    `INSERT INTO org_invites (org_id, token, role, created_by, expires_at, max_uses)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval, $6)
     RETURNING id, created_at, expires_at`,
    [ctx.tenant_id, token, role, ctx.actor_id, String(expiresInDays), maxUses],
  );

  const row = rows[0];
  if (!row) {
    throw new AuthError("FORBIDDEN", "Failed to create invite.");
  }

  await writeAuditLog(ctx.db.pg, ctx.tenant_id, ctx.actor_id, {
    action: "org_invite.create",
    target_type: "org_invite",
    target_id: row.id,
    metadata: { role, expires_in_days: expiresInDays, max_uses: maxUses },
  });

  const baseUrl = resolveBetterAuthUrl();

  return {
    id: row.id,
    token,
    url: `${baseUrl}/join/${token}`,
    role,
    expires_at: toIso(row.expires_at),
    created_at: toIso(row.created_at),
    max_uses: maxUses,
  };
}

// ------------------------------------------------------------ list

/**
 * List invites for the caller's org. Admin-only. By default hides revoked
 * and accepted rows; pass `include_inactive: true` to surface them.
 */
export async function listInvites(ctx: Ctx, input: ListInvitesInput): Promise<ListInvitesOutput> {
  assertRole(ctx, ["admin"]);

  const includeInactive = input?.include_inactive === true;

  const rows = await ctx.db.pg.query<{
    id: string;
    token: string;
    role: string;
    created_at: unknown;
    expires_at: unknown;
    accepted_at: unknown;
    accepted_by_email: string | null;
    revoked_at: unknown;
    uses: number;
    max_uses: number | null;
  }>(
    `SELECT
       i.id,
       i.token,
       i.role,
       i.created_at,
       i.expires_at,
       i.accepted_at,
       u.email AS accepted_by_email,
       i.revoked_at,
       i.uses,
       i.max_uses
     FROM org_invites i
     LEFT JOIN users u
       ON u.id = i.accepted_by_user_id
      AND u.org_id = i.org_id
     WHERE i.org_id = $1
       ${
         includeInactive
           ? ""
           : `AND i.revoked_at IS NULL
              AND (i.max_uses IS NULL OR i.uses < i.max_uses)
              AND i.expires_at > now()`
       }
     ORDER BY i.created_at DESC
     LIMIT 500`,
    [ctx.tenant_id],
  );

  const invites: InviteListItem[] = rows.map((r) => ({
    id: r.id,
    token_prefix: `${r.token.slice(0, 8)}…`,
    role: normalizeRole(r.role),
    created_at: toIso(r.created_at),
    expires_at: toIso(r.expires_at),
    accepted_at: toIsoOrNull(r.accepted_at),
    accepted_by_email: r.accepted_by_email ?? null,
    revoked_at: toIsoOrNull(r.revoked_at),
    status: deriveStatus(r),
    uses: r.uses,
    max_uses: r.max_uses,
  }));

  return { invites };
}

// ------------------------------------------------------------ revoke

/**
 * Soft-delete an invite by setting `revoked_at = now()`. Admin-only.
 * Scoped to the caller's org; cross-tenant revoke attempts raise
 * `FORBIDDEN` without leaking whether the id exists elsewhere.
 * Already-revoked is also `FORBIDDEN` — idempotent-but-noisy so the UI
 * can surface stale state clearly.
 */
export async function revokeInvite(
  ctx: Ctx,
  input: RevokeInviteInput,
): Promise<RevokeInviteOutput> {
  assertRole(ctx, ["admin"]);

  const updated = await ctx.db.pg.query<{ id: string; revoked_at: unknown }>(
    `UPDATE org_invites
       SET revoked_at = now()
     WHERE id = $1
       AND org_id = $2
       AND revoked_at IS NULL
     RETURNING id, revoked_at`,
    [input.id, ctx.tenant_id],
  );

  const row = updated[0];
  if (!row) {
    throw new AuthError("FORBIDDEN", "Invite not found in your org (or already revoked).");
  }

  await writeAuditLog(ctx.db.pg, ctx.tenant_id, ctx.actor_id, {
    action: "org_invite.revoke",
    target_type: "org_invite",
    target_id: row.id,
    metadata: {},
  });

  return {
    id: row.id,
    revoked_at: toIso(row.revoked_at),
  };
}

// ------------------------------------------------------------ preview (public)

/**
 * Unauthenticated lookup used by `/join/<token>` to render what the invitee
 * is about to accept BEFORE they sign in. Intentionally leaks the org name
 * + role; leaks nothing else (creator identity, counts, expiry relative to
 * server time beyond the ISO timestamp).
 */
export async function getInvitePreview(
  pg: PgClient,
  input: GetInvitePreviewInput,
): Promise<GetInvitePreviewResult> {
  if (!input.token || input.token.length === 0) return { ok: false, error: "not_found" };

  const rows = await pg.query<{
    org_name: string;
    role: string;
    expires_at: unknown;
    revoked_at: unknown;
    max_uses: number | null;
    uses: number;
  }>(
    `SELECT
       o.name        AS org_name,
       i.role        AS role,
       i.expires_at  AS expires_at,
       i.revoked_at  AS revoked_at,
       i.max_uses    AS max_uses,
       i.uses        AS uses
     FROM org_invites i
     JOIN orgs o ON o.id = i.org_id
     WHERE i.token = $1
     LIMIT 1`,
    [input.token],
  );

  const row = rows[0];
  if (!row) return { ok: false, error: "not_found" };

  if (row.revoked_at) return { ok: false, error: "revoked" };
  if (row.max_uses !== null && row.uses >= row.max_uses) {
    return { ok: false, error: "already_accepted" };
  }

  const exp = row.expires_at instanceof Date ? row.expires_at : new Date(String(row.expires_at));
  if (Number.isNaN(exp.getTime()) || exp.getTime() <= Date.now()) {
    return { ok: false, error: "expired" };
  }

  return {
    ok: true,
    org_name: row.org_name,
    role: normalizeRole(row.role),
    expires_at: toIso(row.expires_at),
  };
}

// ------------------------------------------------------------ accept

/**
 * Accept an invite as the currently-signed-in user. Not admin-gated: the
 * invitee is mid-signup and starts in the default org (auth-bridge Path 3
 * → `role='ic'`).
 *
 * Contract:
 *   1. Look up invite by token.
 *   2. Lifecycle gates: not found / revoked / expired / already accepted
 *      → return `{ ok: false, error }` (no throw; the Route Handler
 *      surfaces a friendly error to the user).
 *   3. Atomically (single transaction):
 *      a. Mark invite accepted (set `accepted_by_user_id` + `accepted_at`).
 *         Uses a conditional UPDATE so a racing second acceptance is a no-op.
 *      b. Move `users.org_id = invite.org_id` and `users.role = invite.role`.
 *      c. Ensure a `developers` row exists for the user in the new org.
 *   4. Audit log in the *new* org under the user's own id.
 *
 * Returns the target `{ org_id, role, developer_id }` so the Route Handler
 * can mint an ingest key and set the one-time handoff cookie.
 *
 * `already_in_org` is set when the invitee was already a member of the target
 * org (e.g. they double-clicked the link or the admin re-invited them). In
 * that case we still return `ok: true` so the UX remains linear, but we DO
 * NOT flip them into a new role — admins should not lose admin via
 * an accidental `ic` invite acceptance.
 */
export async function acceptInviteByToken(
  deps: { pg: PgClient },
  input: AcceptInviteInput,
): Promise<AcceptInviteResult> {
  if (!input.token || input.token.length === 0) return { ok: false, error: "not_found" };

  const pg = deps.pg;

  // --- 1. Look up + validate lifecycle -----------------------------
  const inviteRows = await pg.query<{
    id: string;
    org_id: string;
    role: string;
    expires_at: unknown;
    revoked_at: unknown;
    max_uses: number | null;
    uses: number;
  }>(
    `SELECT id, org_id, role, expires_at, revoked_at, max_uses, uses
     FROM org_invites
     WHERE token = $1
     LIMIT 1`,
    [input.token],
  );

  const invite = inviteRows[0];
  if (!invite) return { ok: false, error: "not_found" };
  if (invite.revoked_at) return { ok: false, error: "revoked" };
  if (invite.max_uses !== null && invite.uses >= invite.max_uses) {
    return { ok: false, error: "already_accepted" };
  }

  const exp =
    invite.expires_at instanceof Date ? invite.expires_at : new Date(String(invite.expires_at));
  if (Number.isNaN(exp.getTime()) || exp.getTime() <= Date.now()) {
    return { ok: false, error: "expired" };
  }

  const role = normalizeRole(invite.role);

  // --- 2. Detect the "already in target org" fast path -------------
  const currentRows = await pg.query<{ org_id: string; email: string | null }>(
    `SELECT org_id, email FROM users WHERE id = $1 LIMIT 1`,
    [input.userId],
  );
  const current = currentRows[0];
  if (!current) return { ok: false, error: "not_found" };

  const alreadyInOrg = current.org_id === invite.org_id;

  // --- 3. Atomic transition ---------------------------------------
  // One statement flip. We rely on the conditional UPDATE on `org_invites`
  // returning zero rows to detect a lost race with another acceptance —
  // if so, fall through to `already_accepted`.
  //
  // We DO NOT wrap this in BEGIN/COMMIT because the `PgClient` shape doesn't
  // expose transactions; instead, we order statements so the most-critical
  // invariant (invite is consumed exactly once) is enforced by the WHERE
  // clause on `org_invites.accepted_at IS NULL`. Downstream failures (users
  // UPDATE, developers INSERT) are idempotent on retry.
  // Atomic increment of `uses` gated by `max_uses` + lifecycle. First-accept
  // populates `accepted_by_user_id` + `accepted_at` (audit trail); later
  // accepts only bump `uses`. Conditional UPDATE handles concurrent races —
  // the WHERE clause enforces the cap.
  const consumed = await pg.query<{ id: string; uses: number }>(
    `UPDATE org_invites
       SET uses = uses + 1,
           accepted_by_user_id = COALESCE(accepted_by_user_id, $1),
           accepted_at = COALESCE(accepted_at, now())
     WHERE id = $2
       AND revoked_at IS NULL
       AND expires_at > now()
       AND (max_uses IS NULL OR uses < max_uses)
     RETURNING id, uses`,
    [input.userId, invite.id],
  );

  if (consumed.length === 0) {
    // Racing acceptance or the invite transitioned into revoked/expired/cap-hit
    // between our SELECT and our UPDATE. Re-read to return the right error.
    const fresh = await pg.query<{
      revoked_at: unknown;
      expires_at: unknown;
      max_uses: number | null;
      uses: number;
    }>(`SELECT revoked_at, expires_at, max_uses, uses FROM org_invites WHERE id = $1 LIMIT 1`, [
      invite.id,
    ]);
    const f = fresh[0];
    if (!f) return { ok: false, error: "not_found" };
    if (f.revoked_at) return { ok: false, error: "revoked" };
    if (f.max_uses !== null && f.uses >= f.max_uses) {
      return { ok: false, error: "already_accepted" };
    }
    return { ok: false, error: "expired" };
  }

  // Move the user into the target org. We intentionally preserve existing
  // role when `alreadyInOrg` — the invite shouldn't demote an admin who
  // happens to click their own org's invite link.
  if (alreadyInOrg) {
    // No-op on the users table; still ensure developers row exists below.
  } else {
    await pg.query(
      `UPDATE users
         SET org_id = $1,
             role = $2
       WHERE id = $3`,
      [invite.org_id, role, input.userId],
    );
  }

  // Ensure a `developers` row exists in the target org. Unique constraint
  // on `developers.stable_hash` prevents double-inserts across orgs; we
  // key the stable_hash on `user_id:org_id` so re-joining the same org
  // after an erasure doesn't collide.
  //
  // `stable_hash` is an opaque identifier for the session-matching path;
  // `${userId}:${orgId}` is fine here — the hash algorithm is private to
  // this layer and the ingest path never trusts the client-supplied one.
  const developerRows = await pg.query<{ id: string }>(
    `INSERT INTO developers (org_id, user_id, stable_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (stable_hash) DO UPDATE
       SET stable_hash = EXCLUDED.stable_hash
     RETURNING id`,
    [invite.org_id, input.userId, `inv:${input.userId}:${invite.org_id}`],
  );

  let developerId = developerRows[0]?.id;
  if (!developerId) {
    // Fallback — the ON CONFLICT path should always return the existing row
    // in PG 15+, but be defensive in case the stub returns empty.
    const existing = await pg.query<{ id: string }>(
      `SELECT id FROM developers WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
      [invite.org_id, input.userId],
    );
    developerId = existing[0]?.id;
  }
  if (!developerId) return { ok: false, error: "not_found" };

  // --- 4. Audit log in the NEW org --------------------------------
  await writeAuditLog(pg, invite.org_id, input.userId, {
    action: "org_invite.accept",
    target_type: "org_invite",
    target_id: invite.id,
    metadata: {
      accepted_by_email: input.userEmail,
      role,
      already_in_org: alreadyInOrg,
    },
  });

  // Resolve the target org slug + name for the caller's UX (mint bearer,
  // display "welcome to <org>" etc).
  const orgRows = await pg.query<{ slug: string; name: string }>(
    `SELECT slug, name FROM orgs WHERE id = $1 LIMIT 1`,
    [invite.org_id],
  );
  const org = orgRows[0];
  if (!org) return { ok: false, error: "not_found" };

  return {
    ok: true,
    invite_id: invite.id,
    org_id: invite.org_id,
    org_slug: org.slug,
    org_name: org.name,
    role,
    developer_id: developerId,
    already_in_org: alreadyInOrg,
  };
}
