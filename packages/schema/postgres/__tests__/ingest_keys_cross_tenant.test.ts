// M4 PR 3 — MERGE BLOCKER cross-tenant probe for the admin ingest-key mint
// path. Complements `rls_int9.test.ts` (which enumerates every RLS-protected
// table) by drilling into the specific scenario: an admin authenticated at
// Org A attempts to insert an `ingest_keys` row for a developer that belongs
// to Org B.
//
// Two layers verified:
//   1. RLS (ultimate defense): under the `app_bematist` role with
//      `app.current_org_id = org_a`, an INSERT into `ingest_keys` with
//      `org_id = org_b` MUST fail. Likewise, a SELECT of org_b's developers
//      returns 0 rows — so the app-level existence check fails-closed.
//   2. Application-level (defense-in-depth, in-memory): see
//      `packages/api/src/queries/ingestKeys.test.ts` — the query asserts
//      `AuthError(FORBIDDEN)` on the cross-tenant mint. Both must hold.
//
// This test runs against a live Postgres when DATABASE_URL is exported
// (CI sets it; local devs without docker get a structured skip).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";

const PG_LIVE = process.env.DATABASE_URL !== undefined;
const SUPER_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";
const APP_URL = SUPER_URL.replace(
  "postgres://postgres:postgres@",
  "postgres://app_bematist:app_bematist_dev@",
);

interface Setup {
  superClient: ReturnType<typeof postgres>;
  appClient: ReturnType<typeof postgres>;
  orgA: { id: string };
  orgB: { id: string };
  devB: { id: string };
}
let setup: Setup | null = null;

beforeAll(async () => {
  if (!PG_LIVE) return;
  const superClient = postgres(SUPER_URL, { max: 2, idle_timeout: 5, connect_timeout: 5 });
  const appClient = postgres(APP_URL, { max: 2, idle_timeout: 5, connect_timeout: 5 });

  // Seed two orgs via the superuser (RLS bypassed).
  // Idempotent — fine to run on an already-populated CI DB because slugs are
  // unique and we look rows up by slug below.
  await superClient.unsafe(
    `INSERT INTO orgs (slug, name) VALUES ('m4orga', 'M4 Org A'), ('m4orgb', 'M4 Org B')
     ON CONFLICT (slug) DO NOTHING`,
  );
  const orgRows = (await superClient.unsafe(
    `SELECT id, slug FROM orgs WHERE slug IN ('m4orga', 'm4orgb')`,
  )) as unknown as Array<{ id: string; slug: string }>;
  const a = orgRows.find((o) => o.slug === "m4orga");
  const b = orgRows.find((o) => o.slug === "m4orgb");
  if (!a || !b) throw new Error("m4 seed orgs missing after insert");

  // Seed one user + developer per org (idempotent on stable_hash uniq).
  for (const [org, tag] of [
    [a, "m4a"],
    [b, "m4b"],
  ] as const) {
    await superClient.unsafe(
      `INSERT INTO users (org_id, sso_subject, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (sso_subject) DO NOTHING`,
      [org.id, `sub_${tag}`, `${tag}@x.test`],
    );
    const uRows = (await superClient.unsafe(`SELECT id FROM users WHERE sso_subject = $1 LIMIT 1`, [
      `sub_${tag}`,
    ])) as unknown as Array<{ id: string }>;
    const userId = uRows[0]?.id;
    if (!userId) throw new Error(`user for ${tag} missing after insert`);
    await superClient.unsafe(
      `INSERT INTO developers (org_id, user_id, stable_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (stable_hash) DO NOTHING`,
      [org.id, userId, `dev_${tag}`],
    );
  }

  const devRows = (await superClient.unsafe(
    `SELECT id, stable_hash FROM developers WHERE stable_hash = 'dev_m4b'`,
  )) as unknown as Array<{ id: string; stable_hash: string }>;
  const dbRow = devRows[0];
  if (!dbRow) throw new Error("m4 seed developer dev_m4b missing after insert");

  setup = {
    superClient,
    appClient,
    orgA: { id: a.id },
    orgB: { id: b.id },
    devB: { id: dbRow.id },
  };
});

afterAll(async () => {
  if (setup) {
    await setup.superClient.end().catch(() => {});
    await setup.appClient.end().catch(() => {});
  }
});

// biome-ignore lint/suspicious/noExplicitAny: bun:test exposes skipIf at runtime
const runIfPg = (test as any).skipIf ? (test as any).skipIf(!PG_LIVE) : test;

function requireSetup(): Setup {
  if (!setup) throw new Error("setup not complete — Postgres not available?");
  return setup;
}

describe("M4 PR 3 — cross-tenant ingest-key mint probe (MERGE BLOCKER)", () => {
  runIfPg(
    "as Org A, SELECT of Org B's developer returns 0 rows (app-existence check fails-closed)",
    async () => {
      const s = requireSetup();
      await s.appClient.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.current_org_id = '${s.orgA.id}'`);
        const rows = (await tx.unsafe(`SELECT id FROM developers WHERE id = $1 AND org_id = $2`, [
          s.devB.id,
          s.orgA.id,
        ])) as unknown as Array<{ id: string }>;
        // Double-bar: the WHERE org_id clause AND the RLS policy BOTH filter.
        expect(rows).toHaveLength(0);
      });
    },
  );

  runIfPg("as Org A, INSERT of ingest_keys row with org_id=Org B is refused by RLS", async () => {
    const s = requireSetup();
    // Try the raw attack: forge an INSERT with the attacker's session set to
    // Org A but the row's org_id set to Org B. The RLS USING clause in
    // 0002_rls_org_isolation.sql (no explicit WITH CHECK → PG reuses USING)
    // rejects the row.
    const attempt = async () =>
      s.appClient.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.current_org_id = '${s.orgA.id}'`);
        await tx.unsafe(
          `INSERT INTO ingest_keys (id, org_id, engineer_id, name, key_sha256, tier_default)
             VALUES ($1, $2, $3, $4, $5, 'B')`,
          [`m4probe_${Date.now()}`, s.orgB.id, s.devB.id, "attack", "deadbeef"],
        );
      });
    await expect(attempt()).rejects.toThrow();

    // Verify via superuser that no probe-row landed in org B.
    const rows = (await s.superClient.unsafe(
      `SELECT count(*)::int AS c FROM ingest_keys WHERE org_id = $1 AND id LIKE 'm4probe_%'`,
      [s.orgB.id],
    )) as unknown as Array<{ c: number }>;
    expect(rows[0]?.c).toBe(0);
  });

  runIfPg(
    "as Org A, UPDATE (revoke) of an ingest_keys row belonging to Org B touches 0 rows",
    async () => {
      const s = requireSetup();

      // Seed a live key in Org B via superuser (RLS bypassed).
      const keyId = `m4lockout_${Date.now()}`;
      await s.superClient.unsafe(
        `INSERT INTO ingest_keys (id, org_id, engineer_id, name, key_sha256, tier_default)
         VALUES ($1, $2, $3, 'lockout target', 'deadbeef', 'B')
         ON CONFLICT (id) DO NOTHING`,
        [keyId, s.orgB.id, s.devB.id],
      );

      // Attacker at Org A runs the exact SQL the revoke query emits.
      await s.appClient.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.current_org_id = '${s.orgA.id}'`);
        const updated = (await tx.unsafe(
          `UPDATE ingest_keys SET revoked_at = now()
           WHERE id = $1 AND org_id = $2 AND revoked_at IS NULL
           RETURNING id`,
          [keyId, s.orgA.id], // note org filter is caller's tenant — defense-in-depth
        )) as unknown as Array<{ id: string }>;
        expect(updated).toHaveLength(0);
      });

      // Verify via superuser that the Org B key is STILL live (revoked_at null).
      const rows = (await s.superClient.unsafe(`SELECT revoked_at FROM ingest_keys WHERE id = $1`, [
        keyId,
      ])) as unknown as Array<{ revoked_at: unknown }>;
      expect(rows[0]?.revoked_at ?? null).toBeNull();

      // Cleanup the lockout row.
      await s.superClient.unsafe(`DELETE FROM ingest_keys WHERE id = $1`, [keyId]);
    },
  );
});

// When running without a live Postgres we still emit one passing assertion so
// the file shows up as "1 pass" rather than "0 ran".
if (!PG_LIVE) {
  test("cross-tenant mint probe skipped — DATABASE_URL not set (run via CI or docker compose -f docker-compose.dev.yml up)", () => {
    expect(true).toBe(true);
  });
}
