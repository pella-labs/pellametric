import { assertRole, type Ctx } from "../auth";
import { useFixtures } from "../env";
import type {
  Alert,
  AlertKind,
  AlertSeverity,
  ListAlertsInput,
  ListAlertsOutput,
} from "../schemas/alerts";

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  info: 0,
  warn: 1,
  critical: 2,
};

const KINDS: readonly AlertKind[] = [
  "cost_spike",
  "infinite_loop",
  "collector_offline",
  "repeated_reverts",
  "model_anomaly",
];

/**
 * Anomaly alert feed. Hourly cadence (per CLAUDE.md §AI Rules — not weekly).
 *
 * This query surfaces already-detected alerts from the detector MV; it does
 * NOT detect. Detection lives in Workstream H.
 *
 * RBAC: admin/manager/auditor. Engineers see their own alerts through the
 * `/me` digest, not this feed.
 *
 * Dual-mode:
 *   - `USE_FIXTURES=0` reads Postgres `alerts` table (detector writes Tier-A
 *     safe rows there).
 *   - Otherwise (default) deterministic fixture list.
 */
export async function listAlerts(ctx: Ctx, input: ListAlertsInput): Promise<ListAlertsOutput> {
  assertRole(ctx, ["admin", "manager", "auditor"]);
  if (useFixtures()) return listAlertsFixture(ctx, input);
  return listAlertsReal(ctx, input);
}

async function listAlertsFixture(ctx: Ctx, input: ListAlertsInput): Promise<ListAlertsOutput> {
  const seed = hash(
    `${ctx.tenant_id}|alerts|${input.team_id ?? "_"}|${input.window}|${input.kind ?? "*"}`,
  );
  const minSev = SEVERITY_ORDER[input.min_severity];
  const rowCount = Math.min(input.limit, 40);
  const alerts: Alert[] = [];

  for (let i = 0; i < rowCount; i++) {
    const r = (n: number) => rand(seed + i * 23, n);
    const kind = input.kind ?? KINDS[Math.floor(r(1) * KINDS.length)]!;
    const severity = pickSeverity(r(2));
    if (SEVERITY_ORDER[severity] < minSev) continue;
    alerts.push(buildAlert(kind, severity, ctx.tenant_id, seed, i, r, input));
  }

  alerts.sort(
    (a, b) =>
      SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
      b.triggered_at.localeCompare(a.triggered_at),
  );

  const counts_by_severity = { info: 0, warn: 0, critical: 0 };
  for (const a of alerts) counts_by_severity[a.severity] += 1;

  return {
    window: input.window,
    team_id: input.team_id ?? null,
    alerts,
    counts_by_severity,
  };
}

/**
 * Real-branch Postgres read. RLS on `alerts` constrains to `org_id`; the
 * query still filters explicitly for defense-in-depth.
 *
 * EXPLAIN: composite index on (`org_id`, `triggered_at DESC`, `severity`).
 */
async function listAlertsReal(ctx: Ctx, input: ListAlertsInput): Promise<ListAlertsOutput> {
  const days = WINDOW_DAYS[input.window];
  const minSev = SEVERITY_ORDER[input.min_severity];

  const clauses = ["org_id = $1", "triggered_at >= now() - ($2 || ' days')::interval"];
  const params: unknown[] = [ctx.tenant_id, days];
  if (input.team_id) {
    clauses.push(`team_id = $${params.length + 1}`);
    params.push(input.team_id);
  }
  if (input.kind) {
    clauses.push(`kind = $${params.length + 1}`);
    params.push(input.kind);
  }
  const limitParam = params.length + 1;
  params.push(input.limit);

  const rows = await ctx.db.pg.query<Alert & { severity_rank: number }>(
    `SELECT
       id,
       kind,
       severity,
       engineer_id_hash,
       team_id,
       triggered_at,
       value,
       threshold,
       baseline,
       description,
       scope_ref,
       CASE severity
         WHEN 'critical' THEN 2
         WHEN 'warn' THEN 1
         ELSE 0
       END AS severity_rank
     FROM alerts
     WHERE ${clauses.join(" AND ")}
     ORDER BY severity_rank DESC, triggered_at DESC
     LIMIT $${limitParam}`,
    params,
  );

  const filtered = rows.filter((row) => SEVERITY_ORDER[row.severity] >= minSev);

  const alerts: Alert[] = filtered.map((r) => ({
    id: r.id,
    kind: r.kind,
    severity: r.severity,
    engineer_id_hash: r.engineer_id_hash,
    team_id: r.team_id,
    triggered_at: new Date(r.triggered_at).toISOString(),
    value: Number(r.value),
    threshold: Number(r.threshold),
    baseline: Number(r.baseline),
    description: r.description,
    scope_ref: r.scope_ref,
  }));

  const counts_by_severity = { info: 0, warn: 0, critical: 0 };
  for (const a of alerts) counts_by_severity[a.severity] += 1;

  return {
    window: input.window,
    team_id: input.team_id ?? null,
    alerts,
    counts_by_severity,
  };
}

const WINDOW_DAYS: Record<"7d" | "30d" | "90d", number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function buildAlert(
  kind: AlertKind,
  severity: AlertSeverity,
  tenantId: string,
  seed: number,
  index: number,
  r: (n: number) => number,
  input: ListAlertsInput,
): Alert {
  const baseMs = Date.UTC(2026, 3, 16, 12, 0, 0) - index * 47 * 60 * 1000;
  const orgScope = kind === "collector_offline" && r(3) < 0.6;
  const value = round2(r(4) * 10);
  const threshold = round2(value * 0.7);
  const baseline = round2(threshold * 0.6);
  return {
    id: `alert_${seed.toString(16).slice(-6)}_${index}`,
    kind,
    severity,
    engineer_id_hash: orgScope ? null : hash8(`${tenantId}:${Math.floor(r(5) * 12)}`),
    team_id: input.team_id ?? null,
    triggered_at: new Date(baseMs).toISOString(),
    value,
    threshold,
    baseline,
    description: describe(kind, severity),
    scope_ref: orgScope ? null : `session:${hash8(`${seed}:${index}`)}`,
  };
}

function describe(kind: AlertKind, severity: AlertSeverity): string {
  const sevPrefix =
    severity === "critical" ? "Critical: " : severity === "warn" ? "Warning: " : "Info: ";
  switch (kind) {
    case "cost_spike":
      return `${sevPrefix}rolling-hour cost exceeded 3σ baseline`;
    case "infinite_loop":
      return `${sevPrefix}tool-call loop detected in an active session`;
    case "collector_offline":
      return `${sevPrefix}collector has not reported for the alerting window`;
    case "repeated_reverts":
      return `${sevPrefix}revert ratio above cohort baseline for this window`;
    case "model_anomaly":
      return `${sevPrefix}unit cost changed materially vs. pinned pricing table`;
  }
}

function pickSeverity(r: number): AlertSeverity {
  if (r < 0.12) return "critical";
  if (r < 0.45) return "warn";
  return "info";
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hash8(s: string): string {
  return hash(s).toString(16).padStart(8, "0").slice(0, 8);
}

function rand(seed: number, n: number): number {
  const x = Math.sin(seed + n * 19.77) * 10000;
  return x - Math.floor(x);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
