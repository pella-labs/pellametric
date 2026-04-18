// Drizzle-backed AlertEmitter for D20 tier-C admin flips.
// Inserts the IC-banner alert into `alerts` and fires pg_notify on the shared
// `bematist_alerts` channel so the dashboard SSE routes (apps/web/app/sse/**)
// can push the banner to every connected IC.
//
// Payload shape matches the anomaly notifier's contract (apps/worker/src/jobs/
// anomaly/pg_notifier.ts) — same JSON columns + a `policy_flip` kind so the
// dedicated /sse/policy_flip route can filter server-side by `kind` and ignore
// anomaly rows on the shared channel. Tenant isolation is enforced at the SSE
// route (drops rows where `org_id !== ctx.tenant_id`).

import { alerts } from "@bematist/schema/postgres";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { AlertEmitter, AlertRow } from "./types";

/** Shared notify channel — same identifier the anomaly detector uses. */
export const ALERT_NOTIFY_CHANNEL = "bematist_alerts";

export interface DrizzleAlertEmitterDeps {
  db: PostgresJsDatabase<Record<string, unknown>>;
  /** Override channel name for tests; defaults to ALERT_NOTIFY_CHANNEL. */
  channel?: string;
}

export class DrizzleAlertEmitter implements AlertEmitter {
  private readonly channel: string;
  constructor(private readonly deps: DrizzleAlertEmitterDeps) {
    this.channel = deps.channel ?? ALERT_NOTIFY_CHANNEL;
  }

  async emit(row: AlertRow): Promise<void> {
    const inserted = await this.deps.db
      .insert(alerts)
      .values({
        ts: row.ts,
        org_id: row.org_id,
        kind: row.kind,
        signal: row.signal,
        value: row.value,
        threshold: row.threshold,
        dev_id_hash: row.dev_id_hash,
      })
      .returning({ id: alerts.id, ts: alerts.ts });

    const persisted = inserted[0];
    if (!persisted) return;

    const payload = JSON.stringify({
      id: persisted.id,
      org_id: row.org_id,
      kind: row.kind,
      signal: row.signal,
      value: row.value,
      threshold: row.threshold,
      dev_id_hash: row.dev_id_hash,
      ts: persisted.ts instanceof Date ? persisted.ts.toISOString() : String(persisted.ts),
    });

    // pg_notify() function form accepts a runtime payload as a bound parameter.
    // The statement-level NOTIFY takes only a literal and would invite
    // string-concat bugs here; we route through pg_notify to stay consistent
    // with apps/worker/src/jobs/anomaly/pg_notifier.ts.
    await this.deps.db.execute(sql`SELECT pg_notify(${this.channel}, ${payload})`);
  }
}
