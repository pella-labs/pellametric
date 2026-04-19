import { Card, CardHeader, CardTitle, CardValue } from "@bematist/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { ActiveBlockTile } from "@/components/ActiveBlockTile";
import { SourceBadge } from "@/components/SourceBadge";
import { getLocalData } from "@/lib/local-sources";
import { buildWasteSummary } from "@/lib/waste";
import { WasteStackedBarChart } from "./_waste-chart";

export const metadata: Metadata = {
  title: "Outcomes",
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

function formatHm(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Last path segment of a project identifier. Claude Code slugifies
 * "/Users/san/Desktop/CAPSTONE/bematist" → "-Users-san-Desktop-CAPSTONE-bematist";
 * Codex typically stores the real path. Handle both plus the pass-through case
 * (already a short name). Display-only — the aggregation key in
 * `buildWasteSummary` is still the full path so two projects with the same
 * basename don't collide.
 */
function projectLabel(raw: string): string {
  if (!raw) return "—";
  if (raw.startsWith("/")) {
    const parts = raw.split("/").filter(Boolean);
    return parts[parts.length - 1] || raw;
  }
  if (raw.startsWith("-")) {
    // Claude Code slug: real path `/a/b/c` became `-a-b-c`. Original separator
    // was `/`, so we can't perfectly recover project names that had internal
    // dashes — but the common case is a version suffix ("Medbridge-v2",
    // "factory-v4"). Heuristic: take the last dash-segment; if it looks like a
    // version (v2, v4, 3), glue it back to the previous segment.
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

function truncate(s: string, n = 70): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export default async function OutcomesPage() {
  const { claude, codex, analytics, blocks, activeBlock, peakBlockTokens } = await getLocalData();
  const waste = buildWasteSummary(claude, codex, analytics.retryStats.retryCostUsd);
  const productive = Math.max(0, waste.totalCost - waste.totalWaste);

  // Last ~10 real blocks (skip gaps, newest first) — "did I run hot yesterday
  // afternoon or was that block chill?" is a question the IC asks often.
  const recentBlocks = blocks
    .filter((b) => !b.isGap)
    .slice(-10)
    .reverse();
  const { cacheStats } = analytics;

  // Productive-side sorts. Same rows, re-ranked by productive $ (cost − waste).
  // "Most productive" gates on actual work — a 0-edit-turn session is cheap
  // *and* zero-waste, but it isn't productive either, so we exclude it.
  const productiveProjects = [...waste.projects]
    .map((p) => ({ ...p, productiveCost: Math.max(0, p.cost - p.estimatedWaste) }))
    .sort((a, b) => b.productiveCost - a.productiveCost)
    .slice(0, 10);

  const productiveSessions = waste.sessions
    .filter((s) => s.totalEditTurns > 0 && s.wasteRate < 0.5)
    .map((s) => ({ ...s, productiveCost: Math.max(0, s.cost - s.estimatedWaste) }))
    .sort((a, b) => b.productiveCost - a.productiveCost)
    .slice(0, 15);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Outcomes</h1>
        <p className="text-sm text-muted-foreground">
          Productive work on the left, retry waste on the right. Proxy metric until
          outcome-attribution lands (accept events, merged commits); honest caveats below.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardHeader>
            <CardTitle className="text-emerald-400/80">Productive (est.)</CardTitle>
          </CardHeader>
          <CardValue className="text-emerald-400">{USD.format(productive)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            {PCT.format(waste.totalCost > 0 ? productive / waste.totalCost : 0)} of total spend
          </p>
        </Card>
        <Card className="border-red-500/30 bg-red-500/5">
          <CardHeader>
            <CardTitle className="text-red-400/80">Retry waste (est.)</CardTitle>
          </CardHeader>
          <CardValue className="text-red-400">{USD.format(waste.totalWaste)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            {PCT.format(waste.wasteRate)} of total · grammata global:{" "}
            {USD.format(waste.grammataRetryCostUsd)}
          </p>
        </Card>
        <Card className="border-sky-500/30 bg-sky-500/5">
          <CardHeader>
            <CardTitle className="text-sky-400/80">Cache savings</CardTitle>
          </CardHeader>
          <CardValue className="text-sky-400">{USD.format(cacheStats.savingsUsd)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            {PCT.format(cacheStats.hitRate)} hit rate · {TOK.format(cacheStats.totalCacheRead)}{" "}
            cache-read tokens
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>First-try rate</CardTitle>
          </CardHeader>
          <CardValue>{PCT.format(analytics.retryStats.firstTryRate)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            {INT.format(analytics.retryStats.retriedTurns)} retried turns of{" "}
            {INT.format(analytics.retryStats.totalEditTurns)}
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Most retried tool</CardTitle>
          </CardHeader>
          <CardValue className="text-xl font-mono">
            {analytics.retryStats.mostRetriedTool ?? "—"}
          </CardValue>
          <p className="mt-1 text-xs text-muted-foreground truncate">
            {analytics.retryStats.mostRetriedFile
              ? `worst file: ${analytics.retryStats.mostRetriedFile}`
              : "no stand-out file"}
          </p>
        </Card>
      </section>

      {activeBlock ? (
        <ActiveBlockTile snapshot={activeBlock} peakTokens={peakBlockTokens} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Current billing block</CardTitle>
          </CardHeader>
          <p className="text-sm text-muted-foreground">
            No active 5-hour block right now. Start a session and this tile will light up with burn
            rate + projected cost.
          </p>
        </Card>
      )}

      {recentBlocks.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent 5-hour blocks</CardTitle>
          </CardHeader>
          <p className="text-xs text-muted-foreground">
            Claude&apos;s actual rate-limit window. Each row is a 5h block starting at the first
            message; cost and tokens are the sum of sessions in that window.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm min-w-[36rem]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2">Started</th>
                  <th className="pb-2">Sources</th>
                  <th className="pb-2 text-right">Sessions</th>
                  <th className="pb-2 text-right">Cost</th>
                  <th className="pb-2 text-right">Tokens</th>
                  <th className="pb-2 text-right">Cache</th>
                  <th className="pb-2">Models</th>
                </tr>
              </thead>
              <tbody>
                {recentBlocks.map((b) => {
                  const totalTok =
                    b.inputTokens + b.outputTokens + b.cacheReadTokens + b.cacheCreateTokens;
                  const cachePct =
                    b.inputTokens + b.cacheReadTokens > 0
                      ? b.cacheReadTokens / (b.inputTokens + b.cacheReadTokens)
                      : 0;
                  return (
                    <tr key={b.startMs} className="border-t border-border/40 align-top">
                      <td className="py-2 text-xs whitespace-nowrap">
                        {new Date(b.startMs).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {b.isActive ? (
                          <span className="ml-1 text-[10px] font-semibold text-primary">
                            · LIVE
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {b.sources.map((s) => (
                            <SourceBadge
                              key={s}
                              source={s as "claude-code" | "codex" | "cursor"}
                              size="xs"
                            />
                          ))}
                        </div>
                      </td>
                      <td className="py-2 text-right tabular-nums">{INT.format(b.entryCount)}</td>
                      <td className="py-2 text-right tabular-nums">{USD.format(b.cost)}</td>
                      <td className="py-2 text-right tabular-nums text-xs">
                        {TOK.format(totalTok)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-xs text-sky-400">
                        {PCT.format(cachePct)}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground font-mono truncate max-w-[14rem]">
                        {b.models.join(", ") || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Daily $ — productive vs. retry waste</CardTitle>
        </CardHeader>
        <WasteStackedBarChart
          mode="abs"
          height={300}
          data={waste.daily.map((d) => ({
            date: d.date,
            productive: Number(d.productive.toFixed(2)),
            retryWaste: Number(d.retryWaste.toFixed(2)),
          }))}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Absolute $ per day — bar height shows actual spend, the red slice is the estimated retry
          waste inside it. Y-axis is capped at the 95th-percentile day so one outlier doesn&apos;t
          flatten the rest; hover any bar for the true number.
        </p>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daily waste ratio (100%-normalized)</CardTitle>
        </CardHeader>
        <WasteStackedBarChart
          mode="percent"
          height={220}
          data={waste.daily.map((d) => ({
            date: d.date,
            productive: Number(d.productive.toFixed(2)),
            retryWaste: Number(d.retryWaste.toFixed(2)),
          }))}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Same data as above, every bar normalized to 100% — shows the waste <em>rate</em> per day
          irrespective of that day&apos;s total spend. Useful for spotting "ugly" days even when
          they were cheap. Per session:{" "}
          <code className="font-mono">waste = cost × (retryCount / totalEditTurns)</code>.
        </p>
        <p className="mt-3 text-xs text-muted-foreground" hidden>
          <strong>How this is computed:</strong> for each session,{" "}
          <code className="font-mono">waste = cost × (retryCount / totalEditTurns)</code>. Sessions
          with zero retries count fully productive. Red slice is the estimate aggregated per day.
          Grammata&apos;s global <code className="font-mono">retryCostUsd</code> (in the tile above)
          uses the same math aggregated differently — the two should agree within a few percent.
        </p>
      </Card>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Column headers — only shown on lg+ where the 2×2 grid makes them
            meaningful. On mobile the Card titles already disambiguate. */}
        <div className="hidden lg:block text-xs font-semibold uppercase tracking-wide text-emerald-400/80">
          Productive
        </div>
        <div className="hidden lg:block text-xs font-semibold uppercase tracking-wide text-red-400/80">
          Retry waste
        </div>

        {/* Row 1 — Projects */}
        <Card className="border-emerald-500/20">
          <CardHeader>
            <CardTitle>Top productive projects</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[28rem]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2">Project</th>
                  <th className="pb-2">Sources</th>
                  <th className="pb-2 text-right">Productive $</th>
                  <th className="pb-2 text-right">Time</th>
                  <th className="pb-2 text-right">First-try</th>
                </tr>
              </thead>
              <tbody>
                {productiveProjects.map((p) => (
                  <tr key={p.project} className="border-t border-border/40">
                    <td
                      className="py-2 text-xs truncate max-w-[14rem] font-medium"
                      title={p.project}
                    >
                      {projectLabel(p.project)}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {p.sources.map((s) => (
                          <SourceBadge key={s} source={s} size="xs" />
                        ))}
                      </div>
                    </td>
                    <td className="py-2 text-right tabular-nums text-emerald-400">
                      {USD.format(p.productiveCost)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-xs text-muted-foreground">
                      {formatHm(p.durationMs)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {PCT.format(Math.max(0, 1 - p.wasteRate))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="border-red-500/20">
          <CardHeader>
            <CardTitle>Biggest-waste projects</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[28rem]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2">Project</th>
                  <th className="pb-2">Sources</th>
                  <th className="pb-2 text-right">Total $</th>
                  <th className="pb-2 text-right">Waste $</th>
                  <th className="pb-2 text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {waste.projects.slice(0, 10).map((p) => (
                  <tr key={p.project} className="border-t border-border/40">
                    <td
                      className="py-2 text-xs truncate max-w-[14rem] font-medium"
                      title={p.project}
                    >
                      {projectLabel(p.project)}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {p.sources.map((s) => (
                          <SourceBadge key={s} source={s} size="xs" />
                        ))}
                      </div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{USD.format(p.cost)}</td>
                    <td className="py-2 text-right tabular-nums text-red-400">
                      {USD.format(p.estimatedWaste)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{PCT.format(p.wasteRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Row 2 — Sessions */}
        <Card className="border-emerald-500/20">
          <CardHeader>
            <CardTitle>Most productive sessions</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[34rem]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2">When</th>
                  <th className="pb-2">Source</th>
                  <th className="pb-2">What</th>
                  <th className="pb-2 text-right">Productive $</th>
                  <th className="pb-2 text-right">Time</th>
                  <th className="pb-2 text-right">First-try</th>
                </tr>
              </thead>
              <tbody>
                {productiveSessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-4 text-xs text-muted-foreground text-center">
                      No productive sessions in range (need ≥1 edit turn and &lt;50% retry rate).
                    </td>
                  </tr>
                ) : (
                  productiveSessions.map((s) => (
                    <tr key={`${s.source}:${s.id}`} className="border-t border-border/40 align-top">
                      <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                        {s.date}
                      </td>
                      <td className="py-2">
                        <SourceBadge source={s.source} size="xs" />
                      </td>
                      <td className="py-2 min-w-0 max-w-[22rem]">
                        <Link
                          href={`/sessions/${s.source}/${encodeURIComponent(s.id)}`}
                          className="text-primary hover:underline text-xs font-medium line-clamp-2 break-words"
                          title={s.summary || s.id}
                        >
                          {truncate(s.summary, 90) || `session ${s.id.slice(0, 8)}`}
                        </Link>
                        <div className="mt-0.5 text-[10px] text-muted-foreground truncate">
                          <span className="font-mono">{s.model || "—"}</span>
                          {s.gitBranch ? (
                            <>
                              {" "}
                              · <span className="font-mono">{s.gitBranch}</span>
                            </>
                          ) : null}
                          {s.topTool ? <> · {s.topTool}</> : null}
                          {" · "}
                          <span className="opacity-70">{projectLabel(s.project)}</span>
                        </div>
                      </td>
                      <td className="py-2 text-right tabular-nums text-emerald-400">
                        {USD.format(s.productiveCost)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-xs text-muted-foreground">
                        {formatHm(s.durationMs)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {PCT.format(Math.max(0, 1 - s.wasteRate))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="border-red-500/20">
          <CardHeader>
            <CardTitle>Worst-waste sessions</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[34rem]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2">When</th>
                  <th className="pb-2">Source</th>
                  <th className="pb-2">What</th>
                  <th className="pb-2 text-right">Total $</th>
                  <th className="pb-2 text-right">Waste $</th>
                  <th className="pb-2 text-right">Retries</th>
                </tr>
              </thead>
              <tbody>
                {waste.sessions.slice(0, 15).map((s) => (
                  <tr key={`${s.source}:${s.id}`} className="border-t border-border/40 align-top">
                    <td className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {s.date}
                    </td>
                    <td className="py-2">
                      <SourceBadge source={s.source} size="xs" />
                    </td>
                    <td className="py-2 min-w-0 max-w-[22rem]">
                      <Link
                        href={`/sessions/${s.source}/${encodeURIComponent(s.id)}`}
                        className="text-primary hover:underline text-xs font-medium line-clamp-2 break-words"
                        title={s.summary || s.id}
                      >
                        {truncate(s.summary, 90) || `session ${s.id.slice(0, 8)}`}
                      </Link>
                      <div className="mt-0.5 text-[10px] text-muted-foreground truncate">
                        <span className="font-mono">{s.model || "—"}</span>
                        {s.gitBranch ? (
                          <>
                            {" "}
                            · <span className="font-mono">{s.gitBranch}</span>
                          </>
                        ) : null}
                        {s.topTool ? <> · {s.topTool}</> : null}
                        {" · "}
                        <span className="opacity-70">{projectLabel(s.project)}</span>
                      </div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{USD.format(s.cost)}</td>
                    <td className="py-2 text-right tabular-nums text-red-400">
                      {USD.format(s.estimatedWaste)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-xs">
                      {s.retryCount}/{s.totalEditTurns || s.retryCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <div className="text-xs text-amber-400/90 leading-relaxed">
          <strong>Honest caveats.</strong> This view uses grammata&apos;s{" "}
          <code className="font-mono">retryCount</code> and{" "}
          <code className="font-mono">totalEditTurns</code> as proxies for &quot;work redone.&quot;
          Real outcome attribution (accepted edits, merged commits, passing tests) isn&apos;t wired
          yet, so a session that retried an edit and ultimately succeeded counts here the same as
          one that gave up. The green&nbsp;+&nbsp;red totals sum to total spend; the split between
          them is an estimate, not a judgment.
        </div>
      </Card>
    </div>
  );
}
