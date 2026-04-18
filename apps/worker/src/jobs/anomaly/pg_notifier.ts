import { alerts } from "@bematist/schema/postgres";
import { sql } from "drizzle-orm";
import type { db as Db } from "../../db";
import type { Alert, AnomalyNotifier } from "./types";

/**
 * Wire-up notifier (A11) — persists the detector's Alert into Postgres `alerts`
 * and fires `pg_notify('bematist_alerts', '<row_json>')` so SSE consumers in
 * apps/web can tail without polling. Detector math is authoritative in
 * `./detector.ts` (PR #27); this file is wiring only.
 *
 * Channel name + payload shape match contract 07 §SSE:
 *   { kind: "anomaly", dev_id_hash, signal, value, threshold, ts }
 * plus the org_id so the SSE route can enforce tenant scope before pushing.
 */
export const ANOMALY_NOTIFY_CHANNEL = "bematist_alerts";

/** Map detector signal → `alerts.kind` discriminator. */
function kindFor(signal: Alert["signal"]): string {
  switch (signal) {
    case "cost_usd":
      return "cost_spike";
    case "input_tokens":
      return "token_spike";
    case "tool_error_rate":
      return "tool_error_spike";
  }
}

export interface PostgresAnomalyNotifierDeps {
  db: typeof Db;
}

export class PostgresAnomalyNotifier implements AnomalyNotifier {
  constructor(private readonly deps: PostgresAnomalyNotifierDeps) {}

  async publish(alert: Alert): Promise<void> {
    const kind = kindFor(alert.signal);
    const inserted = await this.deps.db
      .insert(alerts)
      .values({
        org_id: alert.org_id,
        kind,
        signal: alert.signal,
        value: alert.value,
        threshold: alert.threshold,
        dev_id_hash: alert.engineer_id,
      })
      .returning({ id: alerts.id, ts: alerts.ts });

    const persisted = inserted[0];
    if (!persisted) return;

    const payload = JSON.stringify({
      id: persisted.id,
      org_id: alert.org_id,
      kind,
      signal: alert.signal,
      value: alert.value,
      threshold: alert.threshold,
      dev_id_hash: alert.engineer_id,
      ts: persisted.ts instanceof Date ? persisted.ts.toISOString() : String(persisted.ts),
      hour_bucket: alert.hour_bucket,
      reason: alert.reason,
    });

    // pg_notify is the function form — it accepts a runtime payload, unlike the
    // statement-level NOTIFY which takes a literal only. Pass `payload` as a
    // bound parameter so we never string-concat untrusted-shaped JSON.
    await this.deps.db.execute(sql`SELECT pg_notify(${ANOMALY_NOTIFY_CHANNEL}, ${payload})`);
  }
}
