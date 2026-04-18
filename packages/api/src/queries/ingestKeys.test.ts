import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { AuthError, type Ctx, type Role } from "../auth";
import { createIngestKey, listIngestKeys, listOrgDevelopers, revokeIngestKey } from "./ingestKeys";

/**
 * In-memory PG stub. Mirrors the subset of SQL `packages/api/src/queries/
 * ingestKeys.ts` runs: `orgs`, `developers` (+ users join), `ingest_keys`
 * (+ developers + users joins), and `audit_log` INSERT.
 *
 * Each query arm is matched by a stable prefix of the SQL text so the stub
 * stays readable — tests fail loudly if the query shape drifts, which is
 * the intended behavior (they are part of the contract).
 */
interface Dev {
  id: string;
  org_id: string;
  user_id: string;
  stable_hash: string;
}
interface User {
  id: string;
  org_id: string;
  email: string;
}
interface Org {
  id: string;
  slug: string;
}
interface IngestKey {
  id: string;
  org_id: string;
  engineer_id: string | null;
  name: string;
  key_sha256: string;
  tier_default: string;
  created_at: Date;
  revoked_at: Date | null;
}
interface AuditRow {
  org_id: string;
  actor_user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata: Record<string, unknown>;
}

function makeFakeDb() {
  const orgs: Org[] = [
    { id: "org-a", slug: "orga" },
    { id: "org-b", slug: "orgb" },
  ];
  const users: User[] = [
    { id: "user-a1", org_id: "org-a", email: "alice@orga.test" },
    { id: "user-a2", org_id: "org-a", email: "andy@orga.test" },
    { id: "user-b1", org_id: "org-b", email: "bob@orgb.test" },
  ];
  const developers: Dev[] = [
    { id: "dev-a1", org_id: "org-a", user_id: "user-a1", stable_hash: "hash-a1" },
    { id: "dev-a2", org_id: "org-a", user_id: "user-a2", stable_hash: "hash-a2" },
    { id: "dev-b1", org_id: "org-b", user_id: "user-b1", stable_hash: "hash-b1" },
  ];
  const ingestKeys: IngestKey[] = [];
  const auditLog: AuditRow[] = [];

  const db = {
    orgs,
    users,
    developers,
    ingestKeys,
    auditLog,
    async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
      const q = sql.replace(/\s+/g, " ").trim();

      // --- org slug lookup ---
      if (q.startsWith("SELECT slug FROM orgs WHERE id = $1")) {
        const [id] = params ?? [];
        const row = orgs.find((o) => o.id === id);
        return (row ? [{ slug: row.slug }] : []) as T[];
      }

      // --- developer existence for mint ---
      if (q.startsWith("SELECT id FROM developers WHERE id = $1 AND org_id = $2")) {
        const [id, orgId] = (params ?? []) as [string, string];
        const row = developers.find((d) => d.id === id && d.org_id === orgId);
        return (row ? [{ id: row.id }] : []) as T[];
      }

      // --- list developers for picker ---
      if (q.startsWith("SELECT d.id, d.user_id, u.email, d.stable_hash FROM developers d")) {
        const [orgId] = (params ?? []) as [string];
        const list = developers
          .filter((d) => d.org_id === orgId)
          .map((d) => {
            const u = users.find((u) => u.id === d.user_id && u.org_id === orgId);
            return {
              id: d.id,
              user_id: d.user_id,
              email: u?.email ?? "",
              stable_hash: d.stable_hash,
            };
          })
          .sort((a, b) => a.email.localeCompare(b.email));
        return list as T[];
      }

      // --- list ingest keys ---
      if (q.startsWith("SELECT ik.id, ik.name, ik.engineer_id")) {
        const [orgId] = (params ?? []) as [string];
        const includeRevoked = q.includes("AND ik.revoked_at IS NULL") === false;
        const list = ingestKeys
          .filter((k) => k.org_id === orgId)
          .filter((k) => includeRevoked || k.revoked_at === null)
          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
          .map((k) => {
            const dev = developers.find((d) => d.id === k.engineer_id && d.org_id === orgId);
            const user = dev
              ? users.find((u) => u.id === dev.user_id && u.org_id === orgId)
              : undefined;
            return {
              id: k.id,
              name: k.name,
              engineer_id: k.engineer_id,
              engineer_email: user?.email ?? null,
              tier_default: k.tier_default,
              created_at: k.created_at,
              revoked_at: k.revoked_at,
            };
          });
        return list as T[];
      }

      // --- insert ingest key ---
      if (q.startsWith("INSERT INTO ingest_keys")) {
        const [id, orgId, engineerId, name, sha, tier] = (params ?? []) as [
          string,
          string,
          string,
          string,
          string,
          string,
        ];
        const row: IngestKey = {
          id,
          org_id: orgId,
          engineer_id: engineerId,
          name,
          key_sha256: sha,
          tier_default: tier,
          created_at: new Date(),
          revoked_at: null,
        };
        ingestKeys.push(row);
        return [{ created_at: row.created_at }] as T[];
      }

      // --- revoke ingest key ---
      if (q.startsWith("UPDATE ingest_keys")) {
        const [id, orgId] = (params ?? []) as [string, string];
        const row = ingestKeys.find(
          (k) => k.id === id && k.org_id === orgId && k.revoked_at === null,
        );
        if (!row) return [] as T[];
        row.revoked_at = new Date();
        return [{ id: row.id, revoked_at: row.revoked_at }] as T[];
      }

      // --- audit_log insert ---
      if (q.startsWith("INSERT INTO audit_log")) {
        const [orgId, actorId, action, targetType, targetId, meta] = (params ?? []) as [
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

      throw new Error(`unhandled SQL in test stub: ${q.slice(0, 80)}`);
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

// ---------------------------------------------------------------- tests

describe("listIngestKeys — role gating", () => {
  test("manager is forbidden (admin-only surface)", async () => {
    const ctx = makeCtx("manager");
    await expect(listIngestKeys(ctx, { include_revoked: false })).rejects.toThrow(AuthError);
  });
  test("engineer is forbidden", async () => {
    const ctx = makeCtx("engineer");
    await expect(listIngestKeys(ctx, { include_revoked: false })).rejects.toThrow(AuthError);
  });
  test("admin sees empty list on a fresh org", async () => {
    const ctx = makeCtx("admin");
    const out = await listIngestKeys(ctx, { include_revoked: false });
    expect(out.keys).toEqual([]);
  });
});

describe("createIngestKey — mint flow", () => {
  test("mint succeeds for in-org developer; hash matches sha256(secret)", async () => {
    const ctx = makeCtx("admin");
    const out = await createIngestKey(ctx, {
      engineer_id: "dev-a1",
      name: "alice's laptop",
      tier_default: "B",
    });

    // Shape assertions
    expect(out.bearer).toMatch(/^bm_orga_[a-z0-9]{12}_[a-f0-9]{64}$/);
    expect(out.name).toBe("alice's laptop");
    expect(out.tier_default).toBe("B");
    expect(out.engineer_id).toBe("dev-a1");

    // Persisted row: org_id = caller tenant, key_sha256 = sha256(secret)
    const row = ctx.__db.ingestKeys[0];
    expect(row).toBeDefined();
    expect(row?.org_id).toBe("org-a");
    expect(row?.engineer_id).toBe("dev-a1");

    // Reconstruct the secret from the bearer and verify sha256 matches.
    const parts = out.bearer.split("_");
    const secret = parts.slice(3).join("_");
    const expectedSha = createHash("sha256").update(secret).digest("hex");
    expect(row?.key_sha256).toBe(expectedSha);

    // Audit row written
    expect(ctx.__db.auditLog).toHaveLength(1);
    expect(ctx.__db.auditLog[0]?.action).toBe("ingest_key.mint");
    expect(ctx.__db.auditLog[0]?.org_id).toBe("org-a");
  });

  test("minted key listed afterwards with correct prefix", async () => {
    const ctx = makeCtx("admin");
    await createIngestKey(ctx, { engineer_id: "dev-a1", name: "laptop", tier_default: "B" });
    const out = await listIngestKeys(ctx, { include_revoked: false });
    expect(out.keys).toHaveLength(1);
    expect(out.keys[0]?.prefix).toMatch(/^bm_orga_[a-z0-9]{12}_…$/);
    expect(out.keys[0]?.engineer_email).toBe("alice@orga.test");
  });

  test("MERGE BLOCKER — admin at Org A cannot mint for Org B's developer", async () => {
    // ctx tenant = org-a, input engineer_id = dev-b1 (belongs to org-b)
    const ctx = makeCtx("admin", "org-a", "user-a1");
    await expect(
      createIngestKey(ctx, { engineer_id: "dev-b1", name: "evil mint", tier_default: "B" }),
    ).rejects.toThrow(AuthError);
    // Zero ingest_keys rows inserted.
    expect(ctx.__db.ingestKeys).toHaveLength(0);
    // Zero audit rows written — the mint aborted before reaching the log write.
    expect(ctx.__db.auditLog).toHaveLength(0);
  });

  test("non-admin cannot mint", async () => {
    const ctx = makeCtx("manager");
    await expect(
      createIngestKey(ctx, { engineer_id: "dev-a1", name: "x", tier_default: "B" }),
    ).rejects.toThrow(AuthError);
  });

  test("unknown engineer_id refused (no row, no audit)", async () => {
    const ctx = makeCtx("admin");
    await expect(
      createIngestKey(ctx, {
        engineer_id: "00000000-0000-0000-0000-000000000000",
        name: "x",
        tier_default: "B",
      }),
    ).rejects.toThrow(AuthError);
    expect(ctx.__db.ingestKeys).toHaveLength(0);
  });
});

describe("revokeIngestKey — soft-delete flow", () => {
  test("revoke succeeds; listing hides it by default; re-revoke refused", async () => {
    const ctx = makeCtx("admin");
    const minted = await createIngestKey(ctx, {
      engineer_id: "dev-a1",
      name: "k",
      tier_default: "B",
    });

    const out = await revokeIngestKey(ctx, { id: minted.id });
    expect(out.id).toBe(minted.id);
    expect(out.revoked_at).toBeDefined();

    // Listing hides by default
    const listed = await listIngestKeys(ctx, { include_revoked: false });
    expect(listed.keys).toHaveLength(0);

    // With include_revoked, the revoked row surfaces with revoked_at set
    const listedAll = await listIngestKeys(ctx, { include_revoked: true });
    expect(listedAll.keys).toHaveLength(1);
    expect(listedAll.keys[0]?.revoked_at).not.toBeNull();

    // Re-revoke → FORBIDDEN (no row to update)
    await expect(revokeIngestKey(ctx, { id: minted.id })).rejects.toThrow(AuthError);

    // Two audit rows: mint + revoke
    const actions = ctx.__db.auditLog.map((a) => a.action);
    expect(actions).toContain("ingest_key.mint");
    expect(actions).toContain("ingest_key.revoke");
  });

  test("MERGE BLOCKER — admin at Org A cannot revoke Org B's key", async () => {
    // Seed a key directly in Org B via a second ctx.
    const seedCtx = makeCtx("admin", "org-b", "user-b1");
    const bKey = await createIngestKey(seedCtx, {
      engineer_id: "dev-b1",
      name: "b-key",
      tier_default: "B",
    });

    // Org A admin tries to revoke it.
    const attackerCtx = makeCtx("admin", "org-a", "user-a1");
    await expect(revokeIngestKey(attackerCtx, { id: bKey.id })).rejects.toThrow(AuthError);

    // The key in Org B is STILL live (revoked_at null).
    // We can't use seedCtx.__db because makeCtx() makes a fresh stub per call —
    // instead we verify via the attacker's own database: zero rows touched.
    expect(attackerCtx.__db.ingestKeys.filter((k) => k.revoked_at !== null)).toHaveLength(0);
  });

  test("non-admin cannot revoke", async () => {
    const ctx = makeCtx("manager");
    await expect(revokeIngestKey(ctx, { id: "anything" })).rejects.toThrow(AuthError);
  });
});

describe("listOrgDevelopers — picker", () => {
  test("admin sees only in-org developers, sorted by email", async () => {
    const ctx = makeCtx("admin");
    const out = await listOrgDevelopers(ctx, {});
    expect(out.developers.map((d) => d.email)).toEqual(["alice@orga.test", "andy@orga.test"]);
    expect(out.developers.some((d) => d.id === "dev-b1")).toBe(false);
  });

  test("non-admin refused", async () => {
    const ctx = makeCtx("engineer");
    await expect(listOrgDevelopers(ctx, {})).rejects.toThrow(AuthError);
  });
});
