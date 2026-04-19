import { AreaChart, Badge, Card, CardHeader, CardTitle, CardValue } from "@bematist/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { type FilterKey, SourceFilterBar } from "@/components/SourceFilterBar";
import { WindowFilterBar } from "@/components/WindowFilterBar";
import {
  detectAnomalies,
  detectPlan,
  fileRetryLeaderboard,
  hourDowHeatmap,
  modelMix,
  toolRetryCost,
  weekOverWeek,
} from "@/lib/insights";
import { getLocalDataWindowed, type WindowKey } from "@/lib/local-sources";

export const metadata: Metadata = {
  title: "Insights",
};

export const dynamic = "force-dynamic";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const INT = new Intl.NumberFormat("en-US");
const PCT = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
const TOK = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const CATEGORY_TONES: Record<string, string> = {
  Building: "bg-emerald-500",
  Investigating: "bg-sky-500",
  Debugging: "bg-red-500",
  Testing: "bg-amber-500",
  Refactoring: "bg-violet-500",
  Other: "bg-muted",
};

const VALID_WINDOWS: readonly WindowKey[] = ["7d", "30d", "90d", "all"] as const;
const VALID_SOURCES: readonly FilterKey[] = ["claude-code", "codex", "cursor"] as const;

function parseWindow(v: string | undefined): WindowKey {
  return v && (VALID_WINDOWS as readonly string[]).includes(v) ? (v as WindowKey) : "30d";
}
function parseSource(v: string | undefined): FilterKey | null {
  return v && (VALID_SOURCES as readonly string[]).includes(v) ? (v as FilterKey) : null;
}

function projectLabel(raw: string): string {
  if (!raw) return "—";
  if (raw.startsWith("/")) {
    const parts = raw.split("/").filter(Boolean);
    return parts[parts.length - 1] || raw;
  }
  if (raw.startsWith("-")) {
    const parts = raw.split("-").filter(Boolean);
    if (parts.length === 0) return raw;
    const last = parts[parts.length - 1] ?? raw;
    if (parts.length >= 2 && /^v?\d+$/i.test(last)) {
      const penult = parts[parts.length - 2] ?? "";
      return `${penult}-${last}`;
    }
    return last;
  }
  return raw;
}

function fmtDelta(v: number, fmt: "currency" | "percent" | "number"): string {
  const sign = v > 0 ? "+" : "";
  if (fmt === "currency") return `${sign}${USD.format(v)}`;
  if (fmt === "percent") {
    const pct = (v * 100).toFixed(1);
    return `${sign}${pct}pts`;
  }
  return `${sign}${v.toFixed(1)}`;
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; source?: string }>;
}) {
  const sp = await searchParams;
  const window = parseWindow(sp.window);
  const source = parseSource(sp.source);

  const { analytics, blocks } = await getLocalDataWindowed(window, source);
  const velocity = analytics.costVelocity.map((p) => ({ x: p.date, y: p.costPerHour }));
  const retry = analytics.retryStats;
  const cache = analytics.cacheStats;
  const trend = analytics.costTrend;

  const categories = analytics.categoryBreakdowns;
  const categoryTotal = categories.reduce((a, c) => a + c.cost, 0);
  const branches = analytics.branchCosts.slice(0, 12);
  const models = modelMix(analytics).slice(0, 10);
  const toolCosts = toolRetryCost(analytics).slice(0, 10);
  const wow = weekOverWeek(analytics);
  const heatmap = hourDowHeatmap(analytics.sessionRows);
  const heatmapMax = Math.max(1, ...heatmap.map((c) => c.sessions));
  const plan = detectPlan(blocks);
  const fileRetries = fileRetryLeaderboard(analytics.sessionRows).slice(0, 10);
  const anomalies = detectAnomalies(analytics);

  const extraWindow = { source: source ?? undefined };
  const extraSource = { window: window === "30d" ? undefined : window };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-muted-foreground">
          Derived metrics over your local session data. No Insight-Engine LLM calls — everything
          here is pure aggregation.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <WindowFilterBar basePath="/insights" current={window} extraParams={extraWindow} />
          <SourceFilterBar basePath="/insights" current={source} extraParams={extraSource} />
        </div>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Weekly cost</CardTitle>
          </CardHeader>
          <CardValue>{USD.format(trend.currentWeekCost)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            {trend.changePercent >= 0 ? "+" : ""}
            {trend.changePercent.toFixed(1)}% vs prior · last week{" "}
            {USD.format(trend.previousWeekCost)}
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>First-try rate</CardTitle>
          </CardHeader>
          <CardValue>{PCT.format(retry.firstTryRate)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            {INT.format(retry.retriedTurns)} retried turns · {USD.format(retry.retryCostUsd)} on
            retries
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cache hit rate</CardTitle>
          </CardHeader>
          <CardValue>{PCT.format(cache.hitRate)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            saved {USD.format(cache.savingsUsd)} · {TOK.format(cache.totalCacheRead)} reads
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Peak hour</CardTitle>
          </CardHeader>
          <CardValue>{analytics.peakHour}:00</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            favorite model: {analytics.favoriteModel || "—"}
          </p>
        </Card>
      </section>

      {/* Week-over-week diff strip */}
      {wow.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>This week vs. last week</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {wow.map((w) => {
              const goodDirection =
                (w.polarity === "up-good" && w.delta > 0) ||
                (w.polarity === "down-good" && w.delta < 0);
              const tone =
                w.delta === 0
                  ? "text-muted-foreground"
                  : goodDirection
                    ? "text-emerald-400"
                    : "text-red-400";
              return (
                <div key={w.label}>
                  <div className="text-xs text-muted-foreground">{w.label}</div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums">
                    {w.format === "currency"
                      ? USD.format(w.current)
                      : w.format === "percent"
                        ? PCT.format(w.current)
                        : INT.format(w.current)}
                  </div>
                  <div className={`text-xs tabular-nums ${tone}`}>
                    {fmtDelta(w.delta, w.format)} vs prior
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {/* Cost velocity + plan-tier */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Cost velocity ($/hour of active session)</CardTitle>
          </CardHeader>
          <AreaChart
            data={velocity}
            format="currency"
            ariaLabel="Cost per active hour"
            height={220}
          />
        </Card>
        <Card className="border-sky-500/30 bg-sky-500/5">
          <CardHeader>
            <CardTitle className="text-sky-400/80">Detected plan tier</CardTitle>
          </CardHeader>
          <CardValue className="text-sky-400">{plan.tier}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            p90 block: {TOK.format(plan.p90Tokens)} tokens · {plan.sampleSize} blocks analyzed ·
            confidence {PCT.format(plan.confidence)}
          </p>
          <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
            Heuristic: Claude plan caps (Pro ≤ 19k, Max5 ≤ 88k, Max20 ≤ 220k tok / 5h block).
            Compares your 90th-percentile block to these bands — pure statistical inference from
            local usage, not auth&apos;d with Anthropic.
          </p>
        </Card>
      </section>

      {/* Activity mix + Model mix */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Activity mix (by spend)</CardTitle>
          </CardHeader>
          {categoryTotal > 0 ? (
            <>
              <div className="mt-2 flex h-3 w-full overflow-hidden rounded bg-muted/40">
                {categories
                  .filter((c) => c.cost > 0)
                  .map((c) => (
                    <div
                      key={c.category}
                      className={CATEGORY_TONES[c.category] ?? "bg-muted"}
                      style={{ width: `${(c.cost / categoryTotal) * 100}%` }}
                      title={`${c.category}: ${USD.format(c.cost)}`}
                    />
                  ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                {categories
                  .filter((c) => c.cost > 0)
                  .sort((a, b) => b.cost - a.cost)
                  .map((c) => (
                    <div key={c.category} className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-sm ${CATEGORY_TONES[c.category] ?? "bg-muted"}`}
                      />
                      <span className="flex-1">{c.category}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {PCT.format(c.cost / categoryTotal)}
                      </span>
                      <span className="tabular-nums">{USD.format(c.cost)}</span>
                    </div>
                  ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Classification by tool mix — Edit/Write heavy = Building, Bash+Read = Debugging,
                WebFetch/Grep = Investigating.
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No activity in this window.</p>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Model mix + retry rate</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2">Model</th>
                  <th className="pb-2 text-right">Share</th>
                  <th className="pb-2 text-right">Cost</th>
                  <th className="pb-2 text-right">Retry rate</th>
                  <th className="pb-2 text-right">Retry $</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.model} className="border-t border-border/40">
                    <td className="py-2 text-xs font-mono truncate max-w-[12rem]">{m.model}</td>
                    <td className="py-2 text-right tabular-nums">{PCT.format(m.costShare)}</td>
                    <td className="py-2 text-right tabular-nums">{USD.format(m.cost)}</td>
                    <td className="py-2 text-right tabular-nums text-xs">
                      {PCT.format(m.retryRate)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-red-400">
                      {USD.format(m.retryCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* Hour × day heatmap */}
      <Card>
        <CardHeader>
          <CardTitle>When you work — hour × day heatmap</CardTitle>
        </CardHeader>
        <p className="text-xs text-muted-foreground">
          Darker = more sessions. Hover any cell for count + spend.
        </p>
        <div className="mt-3 overflow-x-auto">
          <div className="inline-block min-w-full">
            <div
              className="grid"
              style={{ gridTemplateColumns: "3rem repeat(24, minmax(1rem, 1fr))" }}
            >
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={`hdr-${h}`} className="text-[10px] text-muted-foreground text-center">
                  {h % 3 === 0 ? h : ""}
                </div>
              ))}
              {DOW_LABELS.flatMap((label, d) => [
                <div
                  key={`label-${d}`}
                  className="text-[11px] text-muted-foreground pr-2 self-center"
                >
                  {label}
                </div>,
                ...Array.from({ length: 24 }, (_, h) => {
                  const cell = heatmap[d * 24 + h];
                  const intensity = cell ? cell.sessions / heatmapMax : 0;
                  return (
                    <div
                      key={`${d}-${h}`}
                      className="aspect-square rounded-sm"
                      style={{
                        backgroundColor:
                          intensity === 0
                            ? "rgba(148,163,184,0.08)"
                            : `rgba(56,189,248,${Math.max(0.1, intensity)})`,
                      }}
                      title={
                        cell
                          ? `${DOW_LABELS[d]} ${h}:00 — ${cell.sessions} session${
                              cell.sessions === 1 ? "" : "s"
                            }, ${USD.format(cell.cost)}`
                          : ""
                      }
                    />
                  );
                }),
              ])}
            </div>
          </div>
        </div>
      </Card>

      {/* Branch cost + Tool retry cost */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Where the money went — by git branch</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2">Project</th>
                  <th className="pb-2">Branch</th>
                  <th className="pb-2 text-right">Sessions</th>
                  <th className="pb-2 text-right">Tokens</th>
                  <th className="pb-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {branches.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-xs text-muted-foreground">
                      No git-branch data in this window.
                    </td>
                  </tr>
                ) : (
                  branches.map((b) => (
                    <tr key={`${b.project}:${b.branch}`} className="border-t border-border/40">
                      <td className="py-2 text-xs truncate max-w-[9rem]" title={b.project}>
                        {projectLabel(b.project)}
                      </td>
                      <td className="py-2 text-xs font-mono truncate max-w-[12rem]">
                        {b.branch || "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums">{INT.format(b.sessions)}</td>
                      <td className="py-2 text-right tabular-nums text-xs">
                        {TOK.format(b.tokens)}
                      </td>
                      <td className="py-2 text-right tabular-nums">{USD.format(b.cost)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Retry cost by tool</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2">Tool</th>
                  <th className="pb-2 text-right">Uses</th>
                  <th className="pb-2 text-right">First-try</th>
                  <th className="pb-2 text-right">Rate</th>
                  <th className="pb-2 text-right">Retry $</th>
                </tr>
              </thead>
              <tbody>
                {toolCosts.map((t) => (
                  <tr key={t.tool} className="border-t border-border/40">
                    <td className="py-2 text-xs font-mono">{t.tool}</td>
                    <td className="py-2 text-right tabular-nums">{INT.format(t.total)}</td>
                    <td className="py-2 text-right tabular-nums">{INT.format(t.firstTry)}</td>
                    <td className="py-2 text-right tabular-nums">{PCT.format(t.rate)}</td>
                    <td className="py-2 text-right tabular-nums text-red-400">
                      {USD.format(t.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Retry $ attributed proportional to tool&apos;s retry share in each session.
          </p>
        </Card>
      </section>

      {/* Highest-cost sessions + file retry leaderboard */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Highest-cost sessions</CardTitle>
          </CardHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2">When</th>
                <th className="pb-2">Project</th>
                <th className="pb-2">Model</th>
                <th className="pb-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {[...analytics.sessionRows]
                .sort((a, b) => b.cost - a.cost)
                .slice(0, 10)
                .map((s) => (
                  <tr key={`${s.source}:${s.id}`} className="border-t border-border/40">
                    <td className="py-2 text-xs whitespace-nowrap">
                      {(s.date ?? "").slice(0, 10) || "—"}
                    </td>
                    <td className="py-2 text-xs truncate max-w-[10rem]" title={s.project}>
                      {projectLabel(s.project)}
                    </td>
                    <td className="py-2 text-xs font-mono truncate max-w-[10rem]">
                      <Link
                        href={`/sessions/${s.source}/${encodeURIComponent(s.id)}`}
                        className="text-primary hover:underline"
                      >
                        {s.model || "—"}
                      </Link>
                    </td>
                    <td className="py-2 text-right tabular-nums">{USD.format(s.cost)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {retry.worstSession ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Worst-retries session: <span className="font-mono">{retry.worstSession.name}</span> on{" "}
              {retry.worstSession.date} · burned {USD.format(retry.worstSession.retryCostUsd)} on
              retries
            </p>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Files that keep retrying</CardTitle>
          </CardHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2">File</th>
                <th className="pb-2 text-right">Sessions</th>
                <th className="pb-2 text-right">Est. retry $</th>
              </tr>
            </thead>
            <tbody>
              {fileRetries.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-xs text-muted-foreground">
                    No per-file retry data yet (Claude Code only).
                  </td>
                </tr>
              ) : (
                fileRetries.map((f) => (
                  <tr key={f.file} className="border-t border-border/40">
                    <td className="py-2 text-xs font-mono truncate max-w-[20rem]" title={f.file}>
                      {f.file.split("/").pop()}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {INT.format(f.worstInSessions)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-red-400">
                      {USD.format(f.estRetryCost)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Each row = a file that was the single worst-retried file in one or more sessions.
          </p>
        </Card>
      </section>

      {/* Anomalies */}
      <Card className={anomalies.length > 0 ? "border-amber-500/30 bg-amber-500/5" : undefined}>
        <CardHeader>
          <CardTitle>
            Anomalies{" "}
            {anomalies.length > 0 ? (
              <Badge className="ml-2 text-amber-400">{anomalies.length}</Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        {anomalies.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No days in this window were ≥2σ above their day-of-week baseline. Healthy signal.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Days where spend was ≥2σ above the baseline for that day of the week. Signal, not
              judgment.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2">Date</th>
                    <th className="pb-2 text-right">Cost</th>
                    <th className="pb-2 text-right">Baseline</th>
                    <th className="pb-2 text-right">Z-score</th>
                    <th className="pb-2">Top session</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.map((a) => (
                    <tr key={a.date} className="border-t border-border/40">
                      <td className="py-2 text-xs whitespace-nowrap">{a.date}</td>
                      <td className="py-2 text-right tabular-nums">{USD.format(a.cost)}</td>
                      <td className="py-2 text-right tabular-nums text-xs text-muted-foreground">
                        {USD.format(a.dowBaseline)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-amber-400">
                        {a.zScore.toFixed(1)}σ
                      </td>
                      <td className="py-2 text-xs truncate max-w-[20rem]">
                        {a.topSession ? (
                          <Link
                            href={`/sessions/${a.topSession.source}/${encodeURIComponent(a.topSession.id)}`}
                            className="text-primary hover:underline font-mono"
                          >
                            {projectLabel(a.topSession.project)} · {USD.format(a.topSession.cost)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
