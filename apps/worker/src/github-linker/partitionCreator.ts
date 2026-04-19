// Monthly partition creator for `session_repo_links` (PRD §9.6).
//
// Runs T-7d before the 1st of next month — PgBoss cron in worker/index.ts
// (CLAUDE.md Architecture Rule #4: PgBoss for crons only, not per-event).
// Idempotent: if the partition already exists (seeded by G1 migration or a
// previous tick), we skip. All five indexes declared in §9.6 are attached.
//
// Retention: we DO NOT drop old partitions here — that's a separate worker
// (G2/G3; out of scope for this PR). Drop-partition is the only acceptable
// retention path (Architecture Rule #9).

import type { Sql } from "postgres";

export interface PartitionCreatorResult {
  monthsEnsured: string[]; // e.g. ["2026_05", "2026_06"]
  monthsCreated: string[];
  monthsSkipped: string[];
}

/**
 * Ensure the partition for `targetMonth` (1st-of-month anchor) and the
 * following month exist. Returns which months were new vs. already-there.
 */
export async function ensurePartitionsFor(
  sql: Sql,
  now: Date = new Date(),
): Promise<PartitionCreatorResult> {
  const today = atMidnightUtc(now);
  const in7days = new Date(today.getTime() + 7 * 24 * 3600 * 1000);

  // We always ensure current month + the month containing today+7d — the
  // latter is the cron's raison d'être; the former makes local-dev idempotent.
  const months: Date[] = [firstOfMonthUtc(today)];
  const next = firstOfMonthUtc(in7days);
  if (next.getTime() !== months[0]?.getTime()) months.push(next);
  // Always ensure next-next month too, so long onboarding windows never
  // trip a missing partition between T-7d and the cron actually running.
  months.push(firstOfMonthUtc(addMonths(next, 1)));

  const created: string[] = [];
  const skipped: string[] = [];
  for (const m of months) {
    const { created: c, name } = await ensurePartition(sql, m);
    if (c) created.push(name);
    else skipped.push(name);
  }
  return {
    monthsEnsured: [...created, ...skipped],
    monthsCreated: created,
    monthsSkipped: skipped,
  };
}

async function ensurePartition(
  sql: Sql,
  firstOfMonth: Date,
): Promise<{ created: boolean; name: string }> {
  const name = partitionName(firstOfMonth);
  const startIso = firstOfMonth.toISOString().slice(0, 10);
  const endIso = addMonths(firstOfMonth, 1).toISOString().slice(0, 10);

  const existingRows = (await sql.unsafe(`SELECT 1 FROM pg_class WHERE relname = $1`, [
    name,
  ])) as unknown as Array<unknown>;
  if (existingRows.length > 0) return { created: false, name };

  // Create the partition + five per-partition indexes in a single txn.
  await sql.begin(async (tx) => {
    // FOR VALUES FROM/TO does not accept bind parameters in PG 16 — inline
    // the ISO dates. `startIso`/`endIso` are derived from `firstOfMonth`
    // which is code-controlled, not user input.
    await tx.unsafe(
      `CREATE TABLE "${name}" PARTITION OF session_repo_links
         FOR VALUES FROM ('${startIso}') TO ('${endIso}')`,
    );
    // B5 — partial unique scoped to the active row. Stale rows are history;
    // only one active row per PK tuple at a time. Migration 0008 renames the
    // index to `_active_unique_idx` for the seeded partitions; newly-created
    // partitions adopt the same shape here.
    await tx.unsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${name}_active_unique_idx"
         ON "${name}" (tenant_id, session_id, repo_id_hash, match_reason)
         WHERE stale_at IS NULL`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS "${name}_repo_computed_idx"
         ON "${name}" (tenant_id, repo_id_hash, computed_at DESC)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS "${name}_session_idx"
         ON "${name}" (tenant_id, session_id)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS "${name}_inputs_idx"
         ON "${name}" (tenant_id, inputs_sha256)`,
    );
    await tx.unsafe(
      `CREATE INDEX IF NOT EXISTS "${name}_stale_idx"
         ON "${name}" (tenant_id, stale_at) WHERE stale_at IS NOT NULL`,
    );
    // Defensive: RLS enforce on the partition itself.
    await tx.unsafe(`ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY`);
    await tx.unsafe(`ALTER TABLE "${name}" FORCE ROW LEVEL SECURITY`);
    await tx.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${name}" TO app_bematist`);
  });

  return { created: true, name };
}

function partitionName(firstOfMonth: Date): string {
  const y = firstOfMonth.getUTCFullYear();
  const m = String(firstOfMonth.getUTCMonth() + 1).padStart(2, "0");
  return `session_repo_links_${y}_${m}`;
}

function firstOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  return new Date(Date.UTC(y + Math.floor(m / 12), ((m % 12) + 12) % 12, 1));
}
function atMidnightUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
