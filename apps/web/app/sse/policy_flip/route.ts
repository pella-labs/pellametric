import "server-only";
import postgres from "postgres";
import { getSessionCtx } from "@/lib/session";
import { assertAllowedChannel, sseResponse } from "../_lib/stream";

/**
 * D20 Tier-C admin-flip IC-banner feed.
 *
 * Upstream: apps/ingest/src/policy-flip/drizzleAlerts.ts inserts a row into
 * `alerts` with `kind='policy_flip'`, `signal='tier_c_activated'` and fires
 * pg_notify on `bematist_alerts` (same channel the anomaly detector uses).
 * This route LISTENs on that channel, filters to `kind === "policy_flip"`, and
 * pushes the banner payload to every connected IC dashboard.
 *
 * Per CLAUDE.md §Security Rules (D20):
 *   "Admin flips tenant-wide full-prompt mode with signed Ed25519 config +
 *    7-day cooldown + IC banner."
 * The banner is load-bearing: without it, ICs cannot know their prompt scope
 * changed. Tenant isolation is enforced at the route boundary because LISTEN
 * bypasses RLS.
 */
assertAllowedChannel("policy_flip");

export const dynamic = "force-dynamic";
// Force the Node.js runtime — `postgres` uses `net` sockets (same reason as
// the anomalies SSE route).
export const runtime = "nodejs";

const ALERT_CHANNEL = "bematist_alerts";

interface NotifyPayload {
  id: string;
  org_id: string;
  kind: string;
  signal: string;
  value: number;
  threshold: number;
  dev_id_hash: string | null;
  ts: string;
}

export async function GET() {
  const ctx = await getSessionCtx();
  return sseResponse((push) => {
    const sql = postgres(
      process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/bematist",
      { max: 1, idle_timeout: 0, connect_timeout: 5 },
    );

    let cancelled = false;

    const subscription = sql
      .listen(ALERT_CHANNEL, (raw) => {
        if (cancelled) return;
        let parsed: NotifyPayload;
        try {
          parsed = JSON.parse(raw) as NotifyPayload;
        } catch {
          return;
        }
        // Shared-channel filter: this route only cares about policy_flip rows;
        // anomaly rows flow to /sse/anomalies.
        if (parsed.kind !== "policy_flip") return;
        // Tenant scope — LISTEN bypasses RLS.
        if (parsed.org_id !== ctx.tenant_id) return;
        push({
          kind: "policy_flip",
          payload: {
            id: parsed.id,
            signal: parsed.signal,
            value: parsed.value,
            threshold: parsed.threshold,
            ts: parsed.ts,
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
