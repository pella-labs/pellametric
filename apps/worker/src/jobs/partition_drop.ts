import { audit_log, erasure_requests } from "@bematist/schema/postgres";
import type { ClickHouseClient } from "@clickhouse/client";
import { eq } from "drizzle-orm";
import type { db as Db } from "../db";

/**
 * GDPR partition-drop handler. Contract 09 invariant 7: DROP PARTITION atomic.
 *
 * Scope caveat: `events` partitions by `(toYYYYMM(ts), cityHash64(org_id) % 16)`.
 * Dropping a partition removes ALL orgs that hash to the same shard in that
 * month. In Sprint 1 this is acceptable because we seed only a handful of orgs
 * for testing. For production we must either (a) increase shard count, (b)
 * partition by org_id directly, or (c) switch to `ALTER TABLE DELETE WHERE`
 * (non-atomic but surgical). Tracked as a post-Sprint-1 architectural ticket.
 *
 * Processes up to `BATCH_SIZE` pending requests per invocation.
 */
const BATCH_SIZE = 20;

export interface PartitionDropDeps {
  db: typeof Db;
  ch: ClickHouseClient;
}

export async function handlePartitionDrop(deps: PartitionDropDeps): Promise<number> {
  const { db, ch } = deps;

  const pending = await db
    .select()
    .from(erasure_requests)
    .where(eq(erasure_requests.status, "pending"))
    .orderBy(erasure_requests.ts)
    .limit(BATCH_SIZE);

  let processed = 0;

  for (const req of pending) {
    await db
      .update(erasure_requests)
      .set({ status: "in_progress" })
      .where(eq(erasure_requests.id, req.id));

    try {
      const partitions = await listPartitionsForOrg(ch, req.target_org_id);
      for (const p of partitions) {
        // partition_id format is a tuple serialized as CH literal, e.g. "(202604,7)".
        // DROP PARTITION ID accepts that literal directly.
        await ch.command({
          query: `ALTER TABLE events DROP PARTITION ID '${p}'`,
        });
      }

      await db.insert(audit_log).values({
        org_id: req.target_org_id,
        actor_user_id: req.requester_user_id,
        action: "partition_drop",
        target_type: "engineer",
        target_id: req.target_engineer_id,
        reason: `GDPR erasure — request ${req.id}`,
        metadata_json: { partitions, target_org_id: req.target_org_id },
      });

      await db
        .update(erasure_requests)
        .set({
          status: "completed",
          completed_at: new Date(),
          partition_dropped: "true",
        })
        .where(eq(erasure_requests.id, req.id));

      processed++;
    } catch (err) {
      await db
        .update(erasure_requests)
        .set({ status: "failed" })
        .where(eq(erasure_requests.id, req.id));
      throw err;
    }
  }

  return processed;
}

/**
 * Enumerate all `events` partitions that contain rows for the target org.
 * Partition granularity is (month, shard) where shard = cityHash64(org_id) % 16.
 * We query `system.parts` for distinct partition IDs where that org has data.
 */
async function listPartitionsForOrg(ch: ClickHouseClient, org_id: string): Promise<string[]> {
  const res = await ch.query({
    query: `
      SELECT DISTINCT partition_id
      FROM system.parts
      WHERE database = currentDatabase()
        AND table = 'events'
        AND active = 1
        AND partition_id IN (
          SELECT DISTINCT _partition_id FROM events WHERE org_id = {org:String}
        )
    `,
    query_params: { org: org_id },
    format: "JSONEachRow",
  });
  const rows = (await res.json()) as Array<{ partition_id: string }>;
  return rows.map((r) => r.partition_id);
}
