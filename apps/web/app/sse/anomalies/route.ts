import "server-only";
import postgres from "postgres";
import { getSessionCtx } from "@/lib/session";
import { assertAllowedChannel, sseResponse } from "../_lib/stream";

/**
 * Hourly anomaly detector feed (Workstream H + A11 wire-up).
 *
 * Live source: the worker's `apps/worker/src/jobs/anomaly/pg_notifier.ts`
 * INSERTs into `alerts` and fires `pg_notify('bematist_alerts', '<row_json>')`.
 * This route opens a dedicated Postgres connection, `LISTEN`s on that channel,
 * and pushes each payload — filtered to the caller's `tenant_id` — onto the
 * SSE stream. Hourly cadence (per CLAUDE.md §AI Rules — never per-session).
 *
 * Payload shape per contract 07 §SSE:
 *   { kind: "anomaly", dev_id_hash, signal, value, threshold, ts }
 * with the row's `id`, `org_id`, `hour_bucket`, and `reason` for client
 * deduplication and inline triage. Per-engineer feeds are banned by the
 * channel guard above; cross-tenant rows are dropped at the route boundary.
 */
assertAllowedChannel("anomalies");

export const dynamic = "force-dynamic";
// Force the Node.js runtime — the `postgres` driver uses `net` sockets which
// the Edge runtime does not provide. Without this, `LISTEN`-loop SSE crashes
// at deploy time with "Module not found: 'net'".
export const runtime = "nodejs";

const ANOMALY_CHANNEL = "bematist_alerts";

interface NotifyPayload {
  id: string;
  org_id: string;
  kind: string;
  signal: string;
  value: number;
  threshold: number;
  dev_id_hash: string | null;
  ts: string;
  hour_bucket: string;
  reason: string;
}

export async function GET() {
  const ctx = await getSessionCtx();
  return sseResponse((push) => {
    const sql = postgres(
      process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist",
      { max: 1, idle_timeout: 0, connect_timeout: 5 },
    );

    let cancelled = false;

    // postgres-js exposes LISTEN as a Promise<{ unlisten }>. We start it eagerly
    // and store the disposer for cancel-time cleanup. A swallowed reject keeps
    // the route from 500-ing on a cold dev DB — clients still get heartbeats
    // until reconnect.
    const subscription = sql
      .listen(ANOMALY_CHANNEL, (raw) => {
        if (cancelled) return;
        let parsed: NotifyPayload;
        try {
          parsed = JSON.parse(raw) as NotifyPayload;
        } catch {
          return;
        }
        // Tenant scope — drop anything not owned by the caller's org. RLS
        // would catch this on a SELECT path; LISTEN bypasses RLS so we
        // enforce here. NEVER push another tenant's row to this client.
        if (parsed.org_id !== ctx.tenant_id) return;
        push({
          kind: "anomaly",
          payload: {
            id: parsed.id,
            dev_id_hash: parsed.dev_id_hash,
            signal: parsed.signal,
            value: parsed.value,
            threshold: parsed.threshold,
            ts: parsed.ts,
            hour_bucket: parsed.hour_bucket,
            reason: parsed.reason,
          },
        });
      })
      .catch(() => null);

    return () => {
      cancelled = true;
      void subscription
        .then(async (sub) => {
          if (sub) await sub.unlisten();
          await sql.end({ timeout: 1 });
        })
        .catch(() => {});
    };
  });
}
