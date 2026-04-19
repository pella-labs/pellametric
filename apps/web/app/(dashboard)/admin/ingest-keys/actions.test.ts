import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { Ctx, Role } from "@bematist/api";
import { createIngestKey, revokeIngestKey } from "@bematist/api";
import {
  type IngestKeyRow,
  type IngestKeyStore,
  LRUCache,
  verifyBearer,
} from "../../../../../ingest/src/auth/verifyIngestKey";

/**
 * End-to-end authZ contract for minted keys.
 *
 * This is the merge-blocker-adjacent test that covers the "revoke → 401
 * within 60s" acceptance criterion: we mint a key via the admin data-access
 * function, authenticate a mock ingest call with that bearer (matching the
 * real `verifyBearer` path), revoke the key, and show that the next
 * `verifyBearer` call with the same bearer returns `null` (→ 401 at the
 * ingest server).
 *
 * We don't go through the Next Server Action shell because `"use server"`
 * functions need Next's request scope — but the zodAction wrapper is tested
 * independently in `apps/web/lib/session-resolver.test.ts`, and the
 * underlying mutation logic IS what the Server Action invokes. If the two
 * diverge the typecheck breaks first.
 */

// ----------------------------------------------------------------
// In-memory PG stub — mirror the SQL the query layer runs. A superset of
// the stub in packages/api/src/queries/ingestKeys.test.ts so we can also
// feed the ingest verifier's IngestKeyStore.
// ----------------------------------------------------------------

interface Org {
  id: string;
  slug: string;
}
interface User {
  id: string;
  org_id: string;
  email: string;
}
interface Dev {
  id: string;
  org_id: string;
  user_id: string;
  stable_hash: string;
}
interface Key {
  id: string;
  org_id: string;
  engineer_id: string | null;
  name: string;
  key_sha256: string;
  tier_default: string;
  created_at: Date;
  revoked_at: Date | null;
}

function seed() {
  const orgs: Org[] = [{ id: "org-a", slug: "orga" }];
  const users: User[] = [{ id: "user-a1", org_id: "org-a", email: "alice@orga.test" }];
  const developers: Dev[] = [
    { id: "dev-a1", org_id: "org-a", user_id: "user-a1", stable_hash: "hash-a1" },
  ];
  const keys: Key[] = [];
  const audit: unknown[] = [];
  return { orgs, users, developers, keys, audit };
}

function makeFakeDb(state: ReturnType<typeof seed>) {
  return {
    async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
      const q = sql.replace(/\s+/g, " ").trim();
      if (q.startsWith("SELECT slug FROM orgs WHERE id = $1")) {
        const [id] = params ?? [];
        const r = state.orgs.find((o) => o.id === id);
        return (r ? [{ slug: r.slug }] : []) as T[];
      }
      if (q.startsWith("SELECT id FROM developers WHERE id = $1 AND org_id = $2")) {
        const [id, orgId] = (params ?? []) as [string, string];
        const r = state.developers.find((d) => d.id === id && d.org_id === orgId);
        return (r ? [{ id: r.id }] : []) as T[];
      }
      if (q.startsWith("INSERT INTO ingest_keys")) {
        const [id, orgId, engineerId, name, sha, tier] = (params ?? []) as [
          string,
          string,
          string,
          string,
          string,
          string,
        ];
        const row: Key = {
          id,
          org_id: orgId,
          engineer_id: engineerId,
          name,
          key_sha256: sha,
          tier_default: tier,
          created_at: new Date(),
          revoked_at: null,
        };
        state.keys.push(row);
        return [{ created_at: row.created_at }] as T[];
      }
      if (q.startsWith("UPDATE ingest_keys")) {
        const [id, orgId] = (params ?? []) as [string, string];
        const r = state.keys.find(
          (k) => k.id === id && k.org_id === orgId && k.revoked_at === null,
        );
        if (!r) return [] as T[];
        r.revoked_at = new Date();
        return [{ id: r.id, revoked_at: r.revoked_at }] as T[];
      }
      if (q.startsWith("INSERT INTO audit_log")) {
        state.audit.push(params);
        return [] as T[];
      }
      throw new Error(`unhandled SQL: ${q.slice(0, 80)}`);
    },
  };
}

function ingestStoreFromState(state: ReturnType<typeof seed>): IngestKeyStore {
  return {
    async get(orgSlug: string, keyId: string): Promise<IngestKeyRow | null> {
      // Replicate pgIngestKeyStore's JOIN: slug → org_id → ingest_keys
      const org = state.orgs.find((o) => o.slug === orgSlug);
      if (!org) return null;
      const k = state.keys.find((x) => x.org_id === org.id && x.id === keyId);
      if (!k) return null;
      return {
        id: k.id,
        org_id: k.org_id,
        engineer_id: k.engineer_id,
        key_sha256: k.key_sha256,
        tier_default: k.tier_default === "A" ? "A" : k.tier_default === "C" ? "C" : "B",
        revoked_at: k.revoked_at,
      };
    },
  };
}

function makeCtx(
  role: Role,
  state: ReturnType<typeof seed>,
  tenantId = "org-a",
  actorId = "user-a1",
): Ctx {
  return {
    tenant_id: tenantId,
    actor_id: actorId,
    role,
    db: {
      pg: makeFakeDb(state),
      ch: { query: async () => [] },
      redis: {
        get: async () => null,
        set: async () => undefined,
        setNx: async () => true,
      },
    },
  };
}

// ----------------------------------------------------------------
// tests
// ----------------------------------------------------------------

describe("mint → verify → revoke → verify-fails — end-to-end auth contract", () => {
  test("minted bearer authenticates the ingest path; revoke causes subsequent 401", async () => {
    const state = seed();
    const ctx = makeCtx("admin", state);

    // 1. Mint a key via the admin flow the UI calls.
    const minted = await createIngestKey(ctx, {
      engineer_id: "dev-a1",
      name: "alice's laptop",
      tier_default: "B",
    });
    expect(minted.bearer).toMatch(/^bm_orga_[a-z0-9]{12}_[a-f0-9]{64}$/);

    // Sanity — the stored sha256 matches sha256(secret).
    const stored = state.keys[0];
    expect(stored).toBeDefined();
    const secret = minted.bearer.split("_").slice(3).join("_");
    expect(stored?.key_sha256).toBe(createHash("sha256").update(secret).digest("hex"));

    // 2. Mock ingest call — feed the bearer through the real verifier code.
    const ingestStore = ingestStoreFromState(state);
    const cache = new LRUCache<string, IngestKeyRow>({ ttlMs: 60_000 });
    const auth1 = await verifyBearer(`Bearer ${minted.bearer}`, ingestStore, cache);
    expect(auth1).not.toBeNull();
    expect(auth1?.tenantId).toBe("org-a");
    expect(auth1?.tier).toBe("B");
    expect(auth1?.keyId).toBe(minted.id);

    // 3. Revoke via the admin flow.
    const revoked = await revokeIngestKey(ctx, { id: minted.id });
    expect(revoked.id).toBe(minted.id);

    // 4. Clear the verifier LRU (the acceptance criterion says "within 60s"
    // — the cache TTL). The underlying store now returns `revoked_at != null`.
    cache.clear();
    const auth2 = await verifyBearer(`Bearer ${minted.bearer}`, ingestStore, cache);
    expect(auth2).toBeNull(); // → 401 at the ingest server
  });

  test("manager cannot mint (defense-in-depth: action layer re-asserts admin)", async () => {
    const state = seed();
    const ctx = makeCtx("manager", state);
    await expect(
      createIngestKey(ctx, { engineer_id: "dev-a1", name: "x", tier_default: "B" }),
    ).rejects.toThrow();
    expect(state.keys).toHaveLength(0);
  });
});
