import { AuthError, assertRole, type Ctx } from "../../auth";
import type {
  RedeliverWebhooksInput,
  RedeliverWebhooksOutput,
} from "../../schemas/github/redeliver";

/**
 * PRD §14 — `POST /api/admin/github/redeliver`.
 *
 * Replay webhooks in the given `[from, to]` window by calling the GitHub App
 * delivery API:
 *   GET  /app/hook/deliveries?per_page=100&cursor=…    (list, paginated)
 *   POST /app/hook/deliveries/:delivery_id/attempts    (trigger redelivery)
 *
 * Rate-limit posture (PRD §11.2 / risk #6):
 *   - per-installation token bucket: 1 req/s floor
 *   - exponential backoff on 429 / secondary-rate-limit 403
 *   - honor `Retry-After` header when present
 *
 * Admin-only. Audit-logged with final counts.
 *
 * Authentication: uses the GitHub App JWT (per-installation access token
 * resolved from the ingest-side token-cache helper in
 * `apps/ingest/src/github-app/token-cache.ts`). The App JWT — NOT an
 * installation token — is what the `/app/hook/deliveries` endpoints
 * require. This is resolved via a caller-supplied `jwtProvider`.
 */

export interface RedeliveryHttpClient {
  /** Returns the JSON response + the raw rate-limit headers. */
  get(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
  post(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
}

export interface RedeliveryDeps {
  http: RedeliveryHttpClient;
  /**
   * Resolve a GitHub App JWT. See `apps/ingest/src/github-app/jwt.ts`. The
   * App JWT (not installation token) is required by /app/hook/deliveries.
   */
  appJwtProvider: () => Promise<string>;
  /** Clock for tests + elapsed measurement. Defaults to Date.now. */
  now?: () => number;
  /** Sleep for the rate-limit pacer (overridable in tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Override GitHub API origin for tests. */
  apiBase?: string;
}

interface DeliveryListItem {
  id: number | string;
  guid: string;
  delivered_at: string;
  event: string;
  installation_id?: number | string | null;
}

export async function redeliverWebhooks(
  ctx: Ctx,
  input: RedeliverWebhooksInput,
  deps: RedeliveryDeps,
): Promise<RedeliverWebhooksOutput> {
  assertRole(ctx, ["admin"]);

  const nowFn = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const apiBase = deps.apiBase ?? "https://api.github.com";
  const startedAt = nowFn();

  // Resolve target installation — default = single installation for tenant.
  const installRows = await ctx.db.pg.query<{ installation_id: string | bigint }>(
    `SELECT installation_id::text AS installation_id
       FROM github_installations
      WHERE tenant_id = $1
        ${input.installation_id ? "AND installation_id = $2" : ""}
      ORDER BY installed_at DESC
      LIMIT 1`,
    input.installation_id ? [ctx.tenant_id, input.installation_id] : [ctx.tenant_id],
  );
  const install = installRows[0];
  if (!install) {
    throw new AuthError(
      "FORBIDDEN",
      "No GitHub installation bound to your org. Connect the GitHub App first.",
    );
  }
  const installationId = String(install.installation_id);

  const fromMs = new Date(input.from).getTime();
  const toMs = new Date(input.to).getTime();
  const eventFilter = input.event_types ? new Set(input.event_types) : null;

  const jwt = await deps.appJwtProvider();
  const hdrs = () => ({
    authorization: `Bearer ${jwt}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "bematist-admin-redeliver/1.0",
  });

  // Paginate deliveries in the window. GitHub returns newest-first; we walk
  // until `delivered_at < from`. The per-installation token bucket enforces
  // 1 req/s floor BETWEEN list pages + BETWEEN redelivery POSTs.
  const deliveries: DeliveryListItem[] = [];
  let cursor: string | null = null;
  let pagesRead = 0;
  const MAX_PAGES = 50; // safety fuse — 5000 deliveries max per call

  while (pagesRead < MAX_PAGES) {
    await pacerSleep(sleep);
    const url = `${apiBase}/app/hook/deliveries?per_page=100` + (cursor ? `&cursor=${cursor}` : "");
    const res = await executeWithBackoff(() => deps.http.get(url, hdrs()), sleep);
    pagesRead++;
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`github-app: /app/hook/deliveries failed status=${res.status}`);
    }
    const page = (res.body ?? []) as DeliveryListItem[];
    if (!Array.isArray(page) || page.length === 0) break;

    let stop = false;
    for (const d of page) {
      const at = new Date(d.delivered_at).getTime();
      if (at < fromMs) {
        stop = true;
        break;
      }
      if (at > toMs) continue;
      // Installation scope — Skip if GitHub attaches a different installation_id.
      if (d.installation_id && String(d.installation_id) !== installationId) continue;
      if (eventFilter && !eventFilter.has(d.event)) continue;
      deliveries.push(d);
    }
    if (stop) break;
    // Cursor = last delivery id; GitHub's API uses `cursor=<id>` pagination.
    const last = page[page.length - 1];
    if (!last) break;
    cursor = String(last.id);
  }

  // Redeliver each — respect rate limit between POSTs.
  let queuedAttempts = 0;
  let failedAttempts = 0;
  for (const d of deliveries) {
    await pacerSleep(sleep);
    const url = `${apiBase}/app/hook/deliveries/${encodeURIComponent(String(d.id))}/attempts`;
    try {
      const res = await executeWithBackoff(() => deps.http.post(url, hdrs()), sleep);
      if (res.status >= 200 && res.status < 300) queuedAttempts++;
      else failedAttempts++;
    } catch {
      failedAttempts++;
    }
  }

  const elapsedSeconds = (nowFn() - startedAt) / 1000;

  try {
    await ctx.db.pg.query(
      `INSERT INTO audit_log
         (org_id, actor_user_id, action, target_type, target_id, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        ctx.tenant_id,
        ctx.actor_id,
        "github.webhook_redelivery_requested",
        "github_installation",
        installationId,
        JSON.stringify({
          from: input.from,
          to: input.to,
          event_types: input.event_types ?? null,
          deliveries_requested: deliveries.length,
          queued_attempts: queuedAttempts,
          failed_attempts: failedAttempts,
          elapsed_seconds: elapsedSeconds,
        }),
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        level: "error",
        module: "api/mutations/github/redeliver",
        msg: "audit_log write failed",
        err: msg,
      }),
    );
  }

  return {
    installation_id: installationId,
    deliveries_requested: deliveries.length,
    queued_attempts: queuedAttempts,
    failed_attempts: failedAttempts,
    elapsed_seconds: elapsedSeconds,
  };
}

/** Per-installation 1 req/s floor (PRD §11.2 / D59). */
async function pacerSleep(sleep: (ms: number) => Promise<void>): Promise<void> {
  await sleep(1000);
}

interface HttpResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/**
 * Exponential backoff on 429 / 403-secondary. Honors `Retry-After` when
 * provided. Max 5 retries (per PRD §11.2 D59). Non-rate-limit errors
 * bubble up so the caller counts them as `failed_attempts`.
 */
async function executeWithBackoff(
  run: () => Promise<HttpResponse>,
  sleep: (ms: number) => Promise<void>,
): Promise<HttpResponse> {
  const MAX_RETRIES = 5;
  let attempt = 0;
  while (true) {
    const res = await run();
    if (res.status !== 429 && res.status !== 403) return res;
    // 403 only triggers backoff when `x-github-request-id` + low rate-limit
    // suggest a secondary rate-limit — we key off Retry-After as the signal.
    const retryAfterSec = Number(res.headers["retry-after"] ?? res.headers["Retry-After"] ?? "0");
    if (attempt >= MAX_RETRIES) return res;
    const backoffMs =
      retryAfterSec > 0 ? retryAfterSec * 1000 : Math.min(60_000 * 2 ** attempt, 900_000); // 60s, 120s, 240s, 480s, 900s cap
    const jitter = Math.floor(backoffMs * (Math.random() * 0.2)); // ±20% jitter
    await sleep(backoffMs + jitter);
    attempt++;
  }
}
