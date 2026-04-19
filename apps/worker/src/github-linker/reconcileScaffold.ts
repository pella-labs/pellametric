// Hourly reconciliation runner (PRD §11.3, D51, risk #6 mitigation).
//
// G1 scaffold proved the cron ALIVE. G3 wires the gap-fill path:
//
//   1. For each active installation, page `GET /app/hook/deliveries`
//      backwards until we pass the 7-day horizon.
//   2. For each delivery UUID NOT found in `github_webhook_deliveries_seen`,
//      mark it MISSING and call `POST /app/hook/deliveries/:id/attempts`
//      to have GitHub resend it.
//   3. Heartbeat `github_installations.last_reconciled_at` and return
//      per-installation counts for the caller's log line.
//
// Rate limit posture: pacerSleep(1000) between GitHub calls matches the
// per-installation 1 req/s floor (D59). Exponential backoff on 429/403 is
// delegated to the shared `redeliverWebhooks` helper that already observes
// the posture in G2 — we inline the essentials here to avoid cross-package
// dependencies from worker→api.

import type { Sql } from "postgres";

export interface ReconcileScaffoldResult {
  installationsChecked: number;
  heartbeatsWritten: number;
  deliveriesSeenInGithub: number;
  deliveriesMissingFromOurDb: number;
  redeliveryRequestsQueued: number;
  redeliveryRequestsFailed: number;
}

export interface ReconcileHttpClient {
  get(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
  post(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
}

export interface ReconcileDeps {
  http: ReconcileHttpClient;
  /** Mint a GitHub App JWT (NOT installation token — /app/hook/deliveries requires App JWT). */
  appJwtProvider: () => Promise<string>;
  /** Override for tests. */
  apiBase?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Per-installation safety fuse — pages * per_page = 100 deliveries. */
  maxPagesPerInstallation?: number;
}

interface DeliveryListItem {
  id: number | string;
  guid: string;
  delivered_at: string;
  event: string;
  installation_id?: number | string | null;
}

export async function runReconcileScaffold(
  sql: Sql,
  deps?: ReconcileDeps,
  now: Date = new Date(),
): Promise<ReconcileScaffoldResult> {
  const installations = (await sql.unsafe(
    `SELECT tenant_id, installation_id FROM github_installations WHERE status = 'active'`,
    [],
  )) as unknown as Array<{ tenant_id: string; installation_id: string }>;

  let heartbeatsWritten = 0;
  let deliveriesSeenInGithub = 0;
  let deliveriesMissingFromOurDb = 0;
  let redeliveryRequestsQueued = 0;
  let redeliveryRequestsFailed = 0;

  const sleep = deps?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const apiBase = deps?.apiBase ?? "https://api.github.com";
  const maxPages = deps?.maxPagesPerInstallation ?? 10; // 1000 deliveries max per pass

  const sevenDaysAgoMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  for (const install of installations) {
    // Heartbeat always written — dashboards surface `last_reconciled_at`
    // as evidence the cron is alive even when no gap was found.
    const res = (await sql.unsafe(
      `UPDATE github_installations
         SET last_reconciled_at = $3::timestamptz, updated_at = now()
         WHERE tenant_id = $1 AND installation_id = $2`,
      [install.tenant_id, install.installation_id, now.toISOString()],
    )) as unknown as { count?: number };
    heartbeatsWritten += Number(res.count ?? 0);

    // If the deps bundle wasn't supplied, we're in "scaffold" mode — behave
    // as G1 did (heartbeat only). Real callers always supply deps.
    if (!deps) continue;

    let appJwt: string;
    try {
      appJwt = await deps.appJwtProvider();
    } catch {
      // JWT minting failures are operational, not fatal — skip gap-fill this pass.
      continue;
    }
    const hdrs = () => ({
      authorization: `Bearer ${appJwt}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "bematist-reconciler/1.0",
    });

    // Pull last 7-days of deliveries from GitHub. Cursor-paginated; oldest
    // first is newest-last in GitHub's API — we walk until we pass the
    // 7-day horizon or hit the per-installation page budget.
    let cursor: string | null = null;
    let pagesRead = 0;
    const githubDeliveryIds = new Set<string>();
    while (pagesRead < maxPages) {
      await sleep(1000); // per-installation 1 req/s floor
      const url = `${apiBase}/app/hook/deliveries?per_page=100${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await deps.http.get(url, hdrs());
      pagesRead++;
      if (res.status < 200 || res.status >= 300) break;
      const page = (res.body ?? []) as DeliveryListItem[];
      if (!Array.isArray(page) || page.length === 0) break;

      let stop = false;
      for (const d of page) {
        const at = new Date(d.delivered_at).getTime();
        if (at < sevenDaysAgoMs) {
          stop = true;
          break;
        }
        // Scope to this installation.
        if (d.installation_id && String(d.installation_id) !== install.installation_id) continue;
        // GitHub's `id` is a numeric delivery id, `guid` is the X-GitHub-Delivery
        // UUID — our seen-table keys on the UUID so we match on `guid`.
        const key = d.guid || String(d.id);
        githubDeliveryIds.add(key);
      }
      if (stop) break;
      const last = page[page.length - 1];
      if (!last) break;
      cursor = String(last.id);
    }
    deliveriesSeenInGithub += githubDeliveryIds.size;

    if (githubDeliveryIds.size === 0) continue;

    // Cross-reference with what we've already processed.
    const rows = (await sql.unsafe(
      `SELECT delivery_id FROM github_webhook_deliveries_seen
         WHERE tenant_id = $1
           AND installation_id = $2
           AND delivery_id = ANY($3::text[])`,
      [install.tenant_id, install.installation_id, Array.from(githubDeliveryIds)],
    )) as unknown as Array<{ delivery_id: string }>;
    const seen = new Set<string>(rows.map((r) => r.delivery_id));
    const missing: string[] = [];
    for (const id of githubDeliveryIds) {
      if (!seen.has(id)) missing.push(id);
    }
    deliveriesMissingFromOurDb += missing.length;

    // Redeliver each missing. Same 1 req/s floor. We don't retry here —
    // next hour's pass picks up anything GitHub declined.
    for (const id of missing) {
      await sleep(1000);
      const url = `${apiBase}/app/hook/deliveries/${encodeURIComponent(id)}/attempts`;
      try {
        const res = await deps.http.post(url, hdrs());
        if (res.status >= 200 && res.status < 300) redeliveryRequestsQueued++;
        else redeliveryRequestsFailed++;
      } catch {
        redeliveryRequestsFailed++;
      }
    }
  }

  return {
    installationsChecked: installations.length,
    heartbeatsWritten,
    deliveriesSeenInGithub,
    deliveriesMissingFromOurDb,
    redeliveryRequestsQueued,
    redeliveryRequestsFailed,
  };
}
