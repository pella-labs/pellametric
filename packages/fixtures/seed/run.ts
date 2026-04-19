import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createClient } from "@clickhouse/client";
import postgres from "postgres";
import { buildPlan, type EventRow, generateDayForDev, type SeedDev } from "./generate";
import { Rng } from "./rng";

/**
 * Perf seed entry point — `bun run seed:perf` (root).
 *
 * Writes ≥1 000 000 events into ClickHouse `events` to satisfy CLAUDE.md
 * §Testing Rules INT11 ("p95 dashboard <2s with 1M seeded events").
 *
 * Streaming insert in batches of 10 000 rows to keep memory ~50 MB.
 *
 * Env:
 *   DATABASE_URL                 control plane (PG)
 *   CLICKHOUSE_URL               events store
 *   CLICKHOUSE_DATABASE          default `bematist`
 *   PERF_SEED_TOTAL_TARGET       override 1 000 000 floor (e.g. quick smoke at 50_000)
 *   PERF_SEED_BATCH_SIZE         default 10 000 rows per insert
 *   PERF_SEED_TRUNCATE           "1" (default) to TRUNCATE events first
 */

const PG_URL = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist";
const CH_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CH_DB = process.env.CLICKHOUSE_DATABASE ?? "bematist";
const TARGET = Number(process.env.PERF_SEED_TOTAL_TARGET ?? 1_000_000);
const BATCH_SIZE = Number(process.env.PERF_SEED_BATCH_SIZE ?? 10_000);
const TRUNCATE = (process.env.PERF_SEED_TRUNCATE ?? "1") === "1";

async function seedControlPlane(devs: SeedDev[], orgs: ReturnType<typeof buildPlan>["orgs"]) {
  const sql = postgres(PG_URL, { max: 1 });
  try {
    if (TRUNCATE) {
      await sql`TRUNCATE TABLE developers, users, orgs RESTART IDENTITY CASCADE`;
    }
    for (const o of orgs) {
      await sql`
        INSERT INTO orgs (id, slug, name)
        VALUES (${o.id}, ${o.slug}, ${o.name})
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      `;
      // Default Tier-B policy per CLAUDE.md D7. The
      // `orgs_insert_default_policy` trigger (migration 0002_sprint1_policies.sql)
      // *should* auto-create this row on the orgs insert, but that migration
      // isn't wired into drizzle's journal — CI currently applies only the
      // auto-generated `0002_daffy_richard_fisk.sql` which creates the table
      // without the trigger. Belt-and-suspenders explicit insert here so the
      // ingest hot path's `enforceTier` step finds the row instead of 500ing
      // with `ORG_POLICY_MISSING` on every k6 request.
      await sql`
        INSERT INTO policies (org_id, tier_c_managed_cloud_optin, tier_default)
        VALUES (${o.id}, FALSE, ${"B"})
        ON CONFLICT (org_id) DO NOTHING
      `;
    }
    for (const d of devs) {
      await sql`
        INSERT INTO users (id, org_id, sso_subject, email)
        VALUES (${d.userId}, ${d.orgId}, ${d.ssoSubject}, ${d.email})
        ON CONFLICT (id) DO NOTHING
      `;
      await sql`
        INSERT INTO developers (org_id, user_id, stable_hash)
        VALUES (${d.orgId}, ${d.userId}, ${d.engineerId})
        ON CONFLICT (stable_hash) DO NOTHING
      `;
    }
  } finally {
    await sql.end();
  }
}

/**
 * Mint a deterministic-secret ingest key for the largest perf org so the k6
 * ingest scenario can post real bearers (`bm_<orgId>_<keyId>_<secret>`).
 * Writes the bearer to PERF_INGEST_BEARER_PATH so the CI workflow can export
 * INGEST_BEARER without echoing the secret into command lines / artifacts.
 *
 * Bearer shape — the `<orgId>` and `<keyId>` bearer segments are locked to
 * `[A-Za-z0-9]+` by `apps/ingest/src/auth/verifyIngestKey.ts`. Two consequences:
 *
 *  - `<orgId>` uses `org.slug` (alphanumeric since PR #60), not `org.id`
 *    (UUID with hyphens). The PG-backed IngestKeyStore joins on `orgs.slug`
 *    to recover the UUID row id for downstream tenant-scoped queries.
 *  - `<keyId>` drops the `perf_<slug>` form (underscore breaks the three-
 *    segment parse) in favor of `perfkey`.
 */
async function mintIngestKey(org: { id: string; slug: string }): Promise<string> {
  const sql = postgres(PG_URL, { max: 1 });
  try {
    const keyId = "perfkey";
    // Deterministic when PERF_KEY_SECRET is set (CI), random otherwise (local).
    const secret = process.env.PERF_KEY_SECRET ?? randomBytes(32).toString("hex");
    const sha256 = createHash("sha256").update(secret).digest("hex");
    await sql`
      INSERT INTO ingest_keys (id, org_id, name, key_sha256, tier_default)
      VALUES (${keyId}, ${org.id}, ${"perf seed key"}, ${sha256}, ${"B"})
      ON CONFLICT (id) DO UPDATE
      SET key_sha256 = EXCLUDED.key_sha256, revoked_at = NULL
    `;
    const bearer = `bm_${org.slug}_${keyId}_${secret}`;
    const outPath = process.env.PERF_INGEST_BEARER_PATH ?? "tests/perf/.ingest-bearer";
    writeFileSync(outPath, bearer, { mode: 0o600 });
    return bearer;
  } finally {
    await sql.end();
  }
}

function _fmtRate(n: number, ms: number): string {
  return ms > 0 ? `${Math.round((n / ms) * 1000).toLocaleString()} ev/s` : "—";
}

function writeDevTenantId(orgId: string): void {
  const outPath = process.env.PERF_DEV_TENANT_PATH ?? "tests/perf/.dev-tenant-id";
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, orgId, { mode: 0o600 });
}

async function main() {
  const rng = new Rng();
  const plan = buildPlan(rng);
  await seedControlPlane(plan.devs, plan.orgs);

  // Mint an ingest key for the largest org so the ingest k6 scenario can
  // POST real bearers. Skipped only if explicitly told to.
  if ((process.env.PERF_SEED_MINT_KEY ?? "1") === "1") {
    const target = plan.orgs[plan.orgs.length - 1]!;
    await mintIngestKey(target);
  }

  // Emit the largest org's UUID so the dashboard's dev-mode `getSessionCtx`
  // (apps/web/lib/session.ts) can resolve a real seeded tenant instead of
  // `"dev-tenant"` — lets the perf workflow flip K6_GATE_M2=1 without standing
  // up a real Better Auth handshake. See dev-docs/m3-gate-followups.md item 1.
  if ((process.env.PERF_SEED_WRITE_DEV_TENANT ?? "1") === "1") {
    const target = plan.orgs[plan.orgs.length - 1]!;
    writeDevTenantId(target.id);
  }

  const ch = createClient({ url: CH_URL, database: CH_DB });
  if (TRUNCATE) {
    await ch.command({ query: "TRUNCATE TABLE events" });
    for (const mv of [
      "dev_daily_rollup",
      "team_weekly_rollup",
      "repo_weekly_rollup",
      "prompt_cluster_stats",
      "cluster_assignment_mv",
    ]) {
      try {
        await ch.command({ query: `TRUNCATE TABLE IF EXISTS ${mv}` });
      } catch (e) {
        // MVs without explicit storage tables are fine to skip.
        console.warn(`[seed:perf] truncate ${mv} skipped: ${(e as Error).message}`);
      }
    }
  }

  let totalInserted = 0;
  let buffer: EventRow[] = [];
  const t0 = Date.now();

  async function flush() {
    if (buffer.length === 0) return;
    await ch.insert({ table: "events", values: buffer, format: "JSONEachRow" });
    totalInserted += buffer.length;
    if (totalInserted % (BATCH_SIZE * 10) === 0 || totalInserted >= TARGET) {
      const _elapsed = Date.now() - t0;
    }
    buffer = [];
  }

  // Generate day-by-day, dev-by-dev. Continue even after we hit `TARGET`
  // until the end of the plan — the gate measures with ≥1M, but real shape
  // means writing the full 90 days for every dev.
  for (let d = 0; d < plan.days; d++) {
    const day = new Date(plan.startDay.getTime() + d * 86_400_000);
    for (const dev of plan.devs) {
      // Modulate slightly so weekends & "ramp up" feel real (10% jitter).
      const dow = day.getUTCDay();
      const isWeekend = dow === 0 || dow === 6;
      const baseEvents = plan.eventsPerDevPerDay;
      const eventsToday = isWeekend
        ? Math.floor(baseEvents * 0.3)
        : baseEvents + (rng.int(20) - 10);

      for (const row of generateDayForDev(rng, dev, day, eventsToday)) {
        buffer.push(row);
        if (buffer.length >= BATCH_SIZE) {
          await flush();
        }
      }
    }
    // Early cut: stop once we've crossed the floor AND inserted at least
    // one full day. Keeps quick smoke runs (PERF_SEED_TOTAL_TARGET=50_000)
    // bounded.
    if (totalInserted >= TARGET) break;
  }

  await flush();
  await ch.close();

  const _elapsed = Date.now() - t0;
  if (totalInserted < TARGET) {
    console.error(`[seed:perf] FAILED to hit ${TARGET.toLocaleString()} target`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[seed:perf] error:", err);
  process.exit(1);
});
