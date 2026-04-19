import { describe, expect, test } from "bun:test";
import { AuthError, type Ctx, type Role } from "../auth";
import {
  acceptInviteByToken,
  createInvite,
  getInvitePreview,
  listInvites,
  revokeInvite,
} from "./invites";

/**
 * In-memory PG stub. Mirrors the subset of SQL `packages/api/src/queries/
 * invites.ts` runs: `orgs`, `users`, `developers`, `org_invites`, `audit_log`.
 *
 * Each query arm is matched by a stable prefix of the SQL text so the stub
 * stays readable — tests fail loudly if the query shape drifts, which is
 * the intended behavior (they are part of the contract).
 */

interface Org {
  id: string;
  slug: string;
  name: string;
}
interface User {
  id: string;
  org_id: string;
  email: string;
  role: string;
}
interface Dev {
  id: string;
  org_id: string;
  user_id: string;
  stable_hash: string;
}
interface Invite {
  id: string;
  org_id: string;
  token: string;
  role: string;
  created_by: string | null;
  expires_at: Date;
  accepted_by_user_id: string | null;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}
interface AuditRow {
  org_id: string;
  actor_user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
}

function parseDaysInterval(raw: string): number {
  // Matches `'${n} days'::interval` shape — the INSERT uses
  // `($5 || ' days')::interval`, so the param is a bare number string.
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 14;
}

function makeFakeDb() {
  const orgs: Org[] = [
    { id: "org-a", slug: "orga", name: "Org A" },
    { id: "org-b", slug: "orgb", name: "Org B" },
    { id: "org-default", slug: "default", name: "Default" },
  ];
  const users: User[] = [
    { id: "user-a1", org_id: "org-a", email: "alice@orga.test", role: "admin" },
    { id: "user-b1", org_id: "org-b", email: "bob@orgb.test", role: "admin" },
    // invitee starts in default org as ic (mirrors auth-bridge path 3)
    { id: "user-new", org_id: "org-default", email: "newbie@example.test", role: "ic" },
  ];
  const developers: Dev[] = [
    { id: "dev-a1", org_id: "org-a", user_id: "user-a1", stable_hash: "hash-a1" },
    { id: "dev-b1", org_id: "org-b", user_id: "user-b1", stable_hash: "hash-b1" },
  ];
  const invites: Invite[] = [];
  const auditLog: AuditRow[] = [];

  let inviteIdSeq = 1;
  let devIdSeq = 100;

  const db = {
    orgs,
    users,
    developers,
    invites,
    auditLog,
    async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
      const q = sql.replace(/\s+/g, " ").trim();
      const p = params ?? [];

      // --- INSERT org_invite ----
      if (q.startsWith("INSERT INTO org_invites")) {
        const [orgId, token, role, createdBy, daysRaw] = p as [
          string,
          string,
          string,
          string,
          string,
        ];
        const now = new Date();
        const days = parseDaysInterval(daysRaw);
        const row: Invite = {
          id: `invite-${inviteIdSeq++}`,
          org_id: orgId,
          token,
          role,
          created_by: createdBy,
          expires_at: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
          accepted_by_user_id: null,
          accepted_at: null,
          revoked_at: null,
          created_at: now,
        };
        invites.push(row);
        return [{ id: row.id, created_at: row.created_at, expires_at: row.expires_at }] as T[];
      }

      // --- list invites ---
      if (q.startsWith("SELECT i.id, i.token, i.role")) {
        const [orgId] = p as [string];
        const includeInactive = !q.includes("AND i.revoked_at IS NULL AND i.accepted_at IS NULL");
        const list = invites
          .filter((i) => i.org_id === orgId)
          .filter((i) => {
            if (includeInactive) return true;
            return (
              i.revoked_at === null && i.accepted_at === null && i.expires_at.getTime() > Date.now()
            );
          })
          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
          .map((i) => {
            const u = users.find((u) => u.id === i.accepted_by_user_id && u.org_id === i.org_id);
            return {
              id: i.id,
              token: i.token,
              role: i.role,
              created_at: i.created_at,
              expires_at: i.expires_at,
              accepted_at: i.accepted_at,
              accepted_by_email: u?.email ?? null,
              revoked_at: i.revoked_at,
            };
          });
        return list as T[];
      }

      // --- preview lookup ----
      if (q.startsWith("SELECT o.name AS org_name, i.role AS role")) {
        const [token] = p as [string];
        const i = invites.find((x) => x.token === token);
        if (!i) return [] as T[];
        const org = orgs.find((o) => o.id === i.org_id);
        if (!org) return [] as T[];
        return [
          {
            org_name: org.name,
            role: i.role,
            expires_at: i.expires_at,
            accepted_at: i.accepted_at,
            revoked_at: i.revoked_at,
          },
        ] as T[];
      }

      // --- accept: SELECT invite by token ----
      if (
        q.startsWith(
          "SELECT id, org_id, role, expires_at, accepted_at, revoked_at FROM org_invites",
        )
      ) {
        const [token] = p as [string];
        const i = invites.find((x) => x.token === token);
        if (!i) return [] as T[];
        return [
          {
            id: i.id,
            org_id: i.org_id,
            role: i.role,
            expires_at: i.expires_at,
            accepted_at: i.accepted_at,
            revoked_at: i.revoked_at,
          },
        ] as T[];
      }

      // --- accept: SELECT users.org_id ----
      if (q.startsWith("SELECT org_id, email FROM users WHERE id = $1")) {
        const [userId] = p as [string];
        const u = users.find((x) => x.id === userId);
        return (u ? [{ org_id: u.org_id, email: u.email }] : []) as T[];
      }

      // --- accept: conditional consume ----
      if (q.startsWith("UPDATE org_invites SET accepted_by_user_id = $1, accepted_at = now()")) {
        const [userId, inviteId] = p as [string, string];
        const i = invites.find((x) => x.id === inviteId);
        if (!i) return [] as T[];
        if (i.accepted_at !== null) return [] as T[];
        if (i.revoked_at !== null) return [] as T[];
        if (i.expires_at.getTime() <= Date.now()) return [] as T[];
        i.accepted_by_user_id = userId;
        i.accepted_at = new Date();
        return [{ id: i.id }] as T[];
      }

      // --- accept: re-read after lost race ----
      if (
        q.startsWith("SELECT accepted_at, revoked_at, expires_at FROM org_invites WHERE id = $1")
      ) {
        const [id] = p as [string];
        const i = invites.find((x) => x.id === id);
        if (!i) return [] as T[];
        return [
          { accepted_at: i.accepted_at, revoked_at: i.revoked_at, expires_at: i.expires_at },
        ] as T[];
      }

      // --- accept: move the user into the new org ----
      if (q.startsWith("UPDATE users SET org_id = $1, role = $2 WHERE id = $3")) {
        const [orgId, role, userId] = p as [string, string, string];
        const u = users.find((x) => x.id === userId);
        if (!u) return [] as T[];
        u.org_id = orgId;
        u.role = role;
        return [] as T[];
      }

      // --- accept: ensure developer row ----
      if (q.startsWith("INSERT INTO developers")) {
        const [orgId, userId, stableHash] = p as [string, string, string];
        const existing = developers.find((d) => d.stable_hash === stableHash);
        if (existing) {
          return [{ id: existing.id }] as T[];
        }
        const row: Dev = {
          id: `dev-${devIdSeq++}`,
          org_id: orgId,
          user_id: userId,
          stable_hash: stableHash,
        };
        developers.push(row);
        return [{ id: row.id }] as T[];
      }

      if (q.startsWith("SELECT id FROM developers WHERE org_id = $1 AND user_id = $2")) {
        const [orgId, userId] = p as [string, string];
        const d = developers.find((x) => x.org_id === orgId && x.user_id === userId);
        return (d ? [{ id: d.id }] : []) as T[];
      }

      // --- target org lookup after accept ---
      if (q.startsWith("SELECT slug, name FROM orgs WHERE id = $1")) {
        const [id] = p as [string];
        const o = orgs.find((x) => x.id === id);
        return (o ? [{ slug: o.slug, name: o.name }] : []) as T[];
      }

      // --- revoke ---
      if (q.startsWith("UPDATE org_invites SET revoked_at = now() WHERE id = $1")) {
        const [id, orgId] = p as [string, string];
        const i = invites.find((x) => x.id === id && x.org_id === orgId && x.revoked_at === null);
        if (!i) return [] as T[];
        i.revoked_at = new Date();
        return [{ id: i.id, revoked_at: i.revoked_at }] as T[];
      }

      // --- audit_log insert ---
      if (q.startsWith("INSERT INTO audit_log")) {
        const [orgId, actorId, action, targetType, targetId, meta] = p as [
          string,
          string,
          string,
          string,
          string,
          string,
        ];
        auditLog.push({
          org_id: orgId,
          actor_user_id: actorId,
          action,
          target_type: targetType,
          target_id: targetId,
          metadata: JSON.parse(meta) as Record<string, unknown>,
        });
        return [] as T[];
      }

      throw new Error(`unhandled SQL in test stub: ${q.slice(0, 120)}`);
    },
  };
  return db;
}

function makeCtx(
  role: Role,
  tenantId = "org-a",
  actorId = "user-a1",
): Ctx & { __db: ReturnType<typeof makeFakeDb> } {
  const db = makeFakeDb();
  return {
    tenant_id: tenantId,
    actor_id: actorId,
    role,
    db: {
      pg: db,
      ch: { query: async () => [] },
      redis: {
        get: async () => null,
        set: async () => undefined,
        setNx: async () => true,
      },
    },
    __db: db,
  };
}

// ---------------------------------------------------------------- create

describe("createInvite — role gating + shape", () => {
  test("manager is forbidden (admin-only surface)", async () => {
    const ctx = makeCtx("manager");
    await expect(createInvite(ctx, { role: "ic", expires_in_days: 14 })).rejects.toThrow(AuthError);
  });

  test("engineer is forbidden", async () => {
    const ctx = makeCtx("engineer");
    await expect(createInvite(ctx, { role: "ic", expires_in_days: 14 })).rejects.toThrow(AuthError);
  });

  test("admin mint produces a URL-safe 43-char token + valid URL + audit row", async () => {
    const ctx = makeCtx("admin");
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    const out = await createInvite(ctx, { role: "ic", expires_in_days: 14 });

    expect(out.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(out.role).toBe("ic");
    expect(out.url).toBe(`http://localhost:3000/join/${out.token}`);
    expect(new Date(out.expires_at).getTime()).toBeGreaterThan(Date.now());

    // Audit row landed in the admin's org.
    expect(ctx.__db.auditLog).toHaveLength(1);
    expect(ctx.__db.auditLog[0]?.action).toBe("org_invite.create");
    expect(ctx.__db.auditLog[0]?.org_id).toBe("org-a");
  });

  test("admin invite roles can be `admin` or `ic`; defaults to `ic`", async () => {
    const ctx = makeCtx("admin");
    const outIc = await createInvite(ctx, { role: "ic", expires_in_days: 14 });
    expect(outIc.role).toBe("ic");

    const outAdmin = await createInvite(ctx, { role: "admin", expires_in_days: 14 });
    expect(outAdmin.role).toBe("admin");
  });
});

// ---------------------------------------------------------------- list

describe("listInvites — filtering", () => {
  test("non-admin refused", async () => {
    const ctx = makeCtx("manager");
    await expect(listInvites(ctx, { include_inactive: false })).rejects.toThrow(AuthError);
  });

  test("admin default list hides accepted + revoked + expired", async () => {
    const ctx = makeCtx("admin");
    // active
    await createInvite(ctx, { role: "ic", expires_in_days: 14 });
    // revoke one
    const toRevoke = await createInvite(ctx, { role: "ic", expires_in_days: 14 });
    await revokeInvite(ctx, { id: toRevoke.id });
    // seed an "already accepted" row directly
    ctx.__db.invites.push({
      id: "invite-accepted",
      org_id: "org-a",
      token: "t".repeat(43),
      role: "ic",
      created_by: "user-a1",
      expires_at: new Date(Date.now() + 86_400_000),
      accepted_by_user_id: "user-a1",
      accepted_at: new Date(),
      revoked_at: null,
      created_at: new Date(),
    });
    // seed an expired row
    ctx.__db.invites.push({
      id: "invite-expired",
      org_id: "org-a",
      token: "x".repeat(43),
      role: "ic",
      created_by: "user-a1",
      expires_at: new Date(Date.now() - 1000),
      accepted_by_user_id: null,
      accepted_at: null,
      revoked_at: null,
      created_at: new Date(),
    });

    const active = await listInvites(ctx, { include_inactive: false });
    expect(active.invites).toHaveLength(1);
    expect(active.invites[0]?.status).toBe("active");
    expect(active.invites[0]?.token_prefix.endsWith("…")).toBe(true);

    const all = await listInvites(ctx, { include_inactive: true });
    const statuses = all.invites.map((i) => i.status).sort();
    expect(statuses).toEqual(["accepted", "active", "expired", "revoked"]);
  });

  test("admin at Org A cannot see Org B invites", async () => {
    const ctx = makeCtx("admin", "org-a", "user-a1");
    // Seed one invite in org-b via direct insert.
    ctx.__db.invites.push({
      id: "invite-b1",
      org_id: "org-b",
      token: "bb".padEnd(43, "b"),
      role: "ic",
      created_by: null,
      expires_at: new Date(Date.now() + 86_400_000),
      accepted_by_user_id: null,
      accepted_at: null,
      revoked_at: null,
      created_at: new Date(),
    });
    const out = await listInvites(ctx, { include_inactive: true });
    expect(out.invites.every((i) => i.id !== "invite-b1")).toBe(true);
  });
});

// ---------------------------------------------------------------- revoke

describe("revokeInvite — admin-gated soft-delete", () => {
  test("non-admin refused", async () => {
    const ctx = makeCtx("manager");
    await expect(revokeInvite(ctx, { id: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(
      AuthError,
    );
  });

  test("admin revoke succeeds; re-revoke FORBIDDEN; audit row written", async () => {
    const ctx = makeCtx("admin");
    const minted = await createInvite(ctx, { role: "ic", expires_in_days: 14 });

    const out = await revokeInvite(ctx, { id: minted.id });
    expect(out.id).toBe(minted.id);

    await expect(revokeInvite(ctx, { id: minted.id })).rejects.toThrow(AuthError);

    const actions = ctx.__db.auditLog.map((a) => a.action);
    expect(actions).toContain("org_invite.create");
    expect(actions).toContain("org_invite.revoke");
  });

  test("MERGE BLOCKER — admin at Org A cannot revoke Org B's invite", async () => {
    const attacker = makeCtx("admin", "org-a", "user-a1");
    // Seed invite in org-b directly
    attacker.__db.invites.push({
      id: "invite-b-victim",
      org_id: "org-b",
      token: "v".repeat(43),
      role: "ic",
      created_by: null,
      expires_at: new Date(Date.now() + 86_400_000),
      accepted_by_user_id: null,
      accepted_at: null,
      revoked_at: null,
      created_at: new Date(),
    });

    await expect(revokeInvite(attacker, { id: "invite-b-victim" })).rejects.toThrow(AuthError);

    // Invite in org-b is STILL live.
    const row = attacker.__db.invites.find((i) => i.id === "invite-b-victim");
    expect(row?.revoked_at).toBeNull();
  });
});

// ---------------------------------------------------------------- preview

describe("getInvitePreview — unauthenticated", () => {
  test("unknown token → not_found", async () => {
    const ctx = makeCtx("admin");
    const out = await getInvitePreview(ctx.db.pg, { token: "nope" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe("not_found");
  });

  test("active invite → returns org name + role", async () => {
    const ctx = makeCtx("admin");
    const minted = await createInvite(ctx, { role: "ic", expires_in_days: 14 });
    const out = await getInvitePreview(ctx.db.pg, { token: minted.token });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.org_name).toBe("Org A");
      expect(out.role).toBe("ic");
    }
  });

  test("revoked invite → revoked", async () => {
    const ctx = makeCtx("admin");
    const minted = await createInvite(ctx, { role: "ic", expires_in_days: 14 });
    await revokeInvite(ctx, { id: minted.id });
    const out = await getInvitePreview(ctx.db.pg, { token: minted.token });
    if (out.ok) throw new Error("expected error");
    expect(out.error).toBe("revoked");
  });

  test("expired invite → expired", async () => {
    const ctx = makeCtx("admin");
    const minted = await createInvite(ctx, { role: "ic", expires_in_days: 14 });
    // Force expiry in the stub.
    const row = ctx.__db.invites.find((i) => i.id === minted.id);
    if (row) row.expires_at = new Date(Date.now() - 1000);
    const out = await getInvitePreview(ctx.db.pg, { token: minted.token });
    if (out.ok) throw new Error("expected error");
    expect(out.error).toBe("expired");
  });

  test("accepted invite → already_accepted", async () => {
    const ctx = makeCtx("admin");
    const minted = await createInvite(ctx, { role: "ic", expires_in_days: 14 });
    const row = ctx.__db.invites.find((i) => i.id === minted.id);
    if (row) {
      row.accepted_by_user_id = "user-new";
      row.accepted_at = new Date();
    }
    const out = await getInvitePreview(ctx.db.pg, { token: minted.token });
    if (out.ok) throw new Error("expected error");
    expect(out.error).toBe("already_accepted");
  });
});

// ---------------------------------------------------------------- accept

describe("acceptInviteByToken — lifecycle gates + atomic flip", () => {
  test("unknown token → not_found", async () => {
    const ctx = makeCtx("admin");
    const out = await acceptInviteByToken(
      { pg: ctx.db.pg },
      { token: "nope", userId: "user-new", userEmail: "newbie@example.test" },
    );
    if (out.ok) throw new Error("expected error");
    expect(out.error).toBe("not_found");
  });

  test("revoked token → revoked", async () => {
    const ctx = makeCtx("admin");
    const minted = await createInvite(ctx, { role: "ic", expires_in_days: 14 });
    await revokeInvite(ctx, { id: minted.id });
    const out = await acceptInviteByToken(
      { pg: ctx.db.pg },
      { token: minted.token, userId: "user-new", userEmail: "newbie@example.test" },
    );
    if (out.ok) throw new Error("expected error");
    expect(out.error).toBe("revoked");
  });

  test("expired token → expired", async () => {
    const ctx = makeCtx("admin");
    const minted = await createInvite(ctx, { role: "ic", expires_in_days: 14 });
    const row = ctx.__db.invites.find((i) => i.id === minted.id);
    if (row) row.expires_at = new Date(Date.now() - 1000);
    const out = await acceptInviteByToken(
      { pg: ctx.db.pg },
      { token: minted.token, userId: "user-new", userEmail: "newbie@example.test" },
    );
    if (out.ok) throw new Error("expected error");
    expect(out.error).toBe("expired");
  });

  test("already-accepted → already_accepted", async () => {
    const ctx = makeCtx("admin");
    const minted = await createInvite(ctx, { role: "ic", expires_in_days: 14 });
    const row = ctx.__db.invites.find((i) => i.id === minted.id);
    if (row) {
      row.accepted_by_user_id = "user-new";
      row.accepted_at = new Date();
    }
    const out = await acceptInviteByToken(
      { pg: ctx.db.pg },
      { token: minted.token, userId: "user-new", userEmail: "newbie@example.test" },
    );
    if (out.ok) throw new Error("expected error");
    expect(out.error).toBe("already_accepted");
  });

  test("happy path: user moves from default → invite org, gets developer row + audit", async () => {
    const ctx = makeCtx("admin");
    const minted = await createInvite(ctx, { role: "ic", expires_in_days: 14 });

    // Invitee starts in org-default.
    const userBefore = ctx.__db.users.find((u) => u.id === "user-new");
    expect(userBefore?.org_id).toBe("org-default");

    const out = await acceptInviteByToken(
      { pg: ctx.db.pg },
      { token: minted.token, userId: "user-new", userEmail: "newbie@example.test" },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect(out.org_id).toBe("org-a");
    expect(out.org_slug).toBe("orga");
    expect(out.role).toBe("ic");
    expect(out.already_in_org).toBe(false);
    expect(out.developer_id).toBeDefined();

    // user.org_id flipped
    const userAfter = ctx.__db.users.find((u) => u.id === "user-new");
    expect(userAfter?.org_id).toBe("org-a");
    expect(userAfter?.role).toBe("ic");

    // developers row exists in the new org
    const dev = ctx.__db.developers.find((d) => d.user_id === "user-new" && d.org_id === "org-a");
    expect(dev).toBeDefined();

    // invite row consumed
    const inviteRow = ctx.__db.invites.find((i) => i.id === minted.id);
    expect(inviteRow?.accepted_by_user_id).toBe("user-new");
    expect(inviteRow?.accepted_at).not.toBeNull();

    // audit in TARGET org (not admin's creation org)
    const acceptAudit = ctx.__db.auditLog.find((a) => a.action === "org_invite.accept");
    expect(acceptAudit?.org_id).toBe("org-a");
    expect(acceptAudit?.actor_user_id).toBe("user-new");
  });

  test("idempotent when invitee is already in target org — no role demotion", async () => {
    const ctx = makeCtx("admin");
    // Seed an admin user already in org-a.
    const existing = ctx.__db.users.find((u) => u.id === "user-a1");
    expect(existing?.role).toBe("admin");

    // Admin creates an `ic` invite; the admin themselves clicks it.
    const minted = await createInvite(ctx, { role: "ic", expires_in_days: 14 });

    const out = await acceptInviteByToken(
      { pg: ctx.db.pg },
      { token: minted.token, userId: "user-a1", userEmail: "alice@orga.test" },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect(out.already_in_org).toBe(true);

    // Admin stays admin — the `ic` invite didn't demote them.
    const after = ctx.__db.users.find((u) => u.id === "user-a1");
    expect(after?.role).toBe("admin");
    expect(after?.org_id).toBe("org-a");
  });

  test("race: two acceptances — second loses with already_accepted", async () => {
    const ctx = makeCtx("admin");
    const minted = await createInvite(ctx, { role: "ic", expires_in_days: 14 });

    const first = await acceptInviteByToken(
      { pg: ctx.db.pg },
      { token: minted.token, userId: "user-new", userEmail: "newbie@example.test" },
    );
    expect(first.ok).toBe(true);

    // Seed a second user and try to double-accept.
    ctx.__db.users.push({
      id: "user-other",
      org_id: "org-default",
      email: "other@example.test",
      role: "ic",
    });
    const second = await acceptInviteByToken(
      { pg: ctx.db.pg },
      { token: minted.token, userId: "user-other", userEmail: "other@example.test" },
    );
    if (second.ok) throw new Error("expected second acceptance to fail");
    expect(second.error).toBe("already_accepted");
  });
});
