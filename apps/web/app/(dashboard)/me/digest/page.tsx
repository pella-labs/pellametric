import { AreaChart, Badge, Card, CardHeader, CardTitle, CardValue } from "@bematist/ui";
import type { Metadata } from "next";
import { ActiveBlockTile } from "@/components/ActiveBlockTile";
import { SourceBadge } from "@/components/SourceBadge";
import { type FilterKey, SourceFilterBar } from "@/components/SourceFilterBar";
import { getLocalDataFor } from "@/lib/local-sources";

export const metadata: Metadata = {
  title: "My digest",
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

function formatDuration(ms: number): string {
  if (!ms || ms < 1000) return `${ms || 0}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function formatMinutesAsHm(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const VALID_FILTERS: readonly FilterKey[] = ["claude-code", "codex", "cursor"] as const;

function parseFilter(v: string | undefined): FilterKey | null {
  return v && (VALID_FILTERS as readonly string[]).includes(v) ? (v as FilterKey) : null;
}

export default async function MyDigestPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp.source);
  const {
    sources,
    analytics,
    blocks,
    activeBlock,
    peakBlockTokens,
    cursor: cursorRaw,
  } = await getLocalDataFor(filter);
  const claude = sources.find((s) => s.key === "claude-code");
  const codex = sources.find((s) => s.key === "codex");
  const cursor = sources.find((s) => s.key === "cursor");
  const recentBlocks = blocks
    .filter((b) => !b.isGap)
    .slice(-12)
    .reverse();
  const recentCursor = cursorRaw
    ? [...cursorRaw.sessions]
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
        .slice(0, 15)
    : [];
  const cursorTabAcceptRate =
    cursorRaw && cursorRaw.totalTabSuggestedLines > 0
      ? cursorRaw.totalTabAcceptedLines / cursorRaw.totalTabSuggestedLines
      : 0;
  const cursorComposerAcceptRate =
    cursorRaw && cursorRaw.totalComposerSuggestedLines > 0
      ? cursorRaw.totalComposerAcceptedLines / cursorRaw.totalComposerSuggestedLines
      : 0;
  const daily = analytics.dailyCosts.map((d) => ({ x: d.date, y: d.cost }));
  const recent = [...analytics.sessionRows]
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 25);
  const topTools = analytics.toolUsage.slice(0, 10);
  const peakHour = analytics.peakHour;
  const hourBars = analytics.hourDistribution;
  const maxHour = Math.max(1, ...hourBars);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">My digest</h1>
        <p className="text-sm text-muted-foreground">
          Your machine, your sessions. Pulled directly from{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">~/.claude</code>,{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">~/.codex</code>, and Cursor&apos;s
          SQLite.
        </p>
        <SourceFilterBar basePath="/me/digest" current={filter} />
      </header>

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

      {filter === "cursor" && cursorRaw ? (
        <>
          <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle>Sessions</CardTitle>
              </CardHeader>
              <CardValue>{INT.format(cursorRaw.sessions.length)}</CardValue>
              <p className="mt-1 text-xs text-muted-foreground">
                {INT.format(cursorRaw.totalMessages)} messages total
              </p>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Lines changed</CardTitle>
              </CardHeader>
              <CardValue className="text-emerald-400">
                +{INT.format(cursorRaw.totalLinesAdded)}
              </CardValue>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="text-red-400/80">−{INT.format(cursorRaw.totalLinesRemoved)}</span>{" "}
                removed
              </p>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Tab accept rate</CardTitle>
              </CardHeader>
              <CardValue>
                {cursorRaw.totalTabSuggestedLines > 0
                  ? `${((cursorRaw.totalTabAcceptedLines / cursorRaw.totalTabSuggestedLines) * 100).toFixed(1)}%`
                  : "—"}
              </CardValue>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {INT.format(cursorRaw.totalTabAcceptedLines)} /{" "}
                {INT.format(cursorRaw.totalTabSuggestedLines)} lines
              </p>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Composer accept rate</CardTitle>
              </CardHeader>
              <CardValue>
                {cursorRaw.totalComposerSuggestedLines > 0
                  ? `${((cursorRaw.totalComposerAcceptedLines / cursorRaw.totalComposerSuggestedLines) * 100).toFixed(1)}%`
                  : "—"}
              </CardValue>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {INT.format(cursorRaw.totalComposerAcceptedLines)} /{" "}
                {INT.format(cursorRaw.totalComposerSuggestedLines)} lines
              </p>
            </Card>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Messages per day</CardTitle>
            </CardHeader>
            <AreaChart
              data={cursorRaw.dailyActivity.map((d) => ({ x: d.date, y: d.messages }))}
              format="number"
              ariaLabel="Messages per day"
              height={220}
            />
          </Card>
        </>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle>Cost</CardTitle>
              </CardHeader>
              <CardValue>{USD.format(analytics.totalCost)}</CardValue>
              <p className="mt-1 text-xs text-muted-foreground">
                {analytics.costTrend.changePercent >= 0 ? "+" : ""}
                {analytics.costTrend.changePercent.toFixed(1)}% vs previous week
              </p>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Sessions</CardTitle>
              </CardHeader>
              <CardValue>{INT.format(analytics.totalSessions)}</CardValue>
              <p className="mt-1 text-xs text-muted-foreground">
                avg {USD.format(analytics.totalCost / Math.max(1, analytics.totalSessions))} /
                session
              </p>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Cache hit rate</CardTitle>
              </CardHeader>
              <CardValue>{PCT.format(analytics.cacheStats.hitRate)}</CardValue>
              <p className="mt-1 text-xs text-muted-foreground">
                saved {USD.format(analytics.cacheStats.savingsUsd)}
              </p>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>First-try rate</CardTitle>
              </CardHeader>
              <CardValue>{PCT.format(analytics.retryStats.firstTryRate)}</CardValue>
              <p className="mt-1 text-xs text-muted-foreground">
                {INT.format(analytics.retryStats.retriedTurns)} retries
              </p>
            </Card>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Cost by day</CardTitle>
            </CardHeader>
            <AreaChart data={daily} format="currency" ariaLabel="Cost per day" height={220} />
          </Card>
        </>
      )}

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Hour of day</CardTitle>
          </CardHeader>
          <div className="flex items-end gap-0.5 h-32">
            {hourBars.map((count, h) => (
              <div
                key={h}
                className="flex-1 rounded-t bg-primary/60"
                style={{ height: `${(count / maxHour) * 100}%`, minHeight: count > 0 ? 2 : 0 }}
                title={`${h}:00 — ${count} sessions`}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>0:00</span>
            <span>peak {peakHour}:00</span>
            <span>23:00</span>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top tools</CardTitle>
          </CardHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2">Tool</th>
                <th className="pb-2 text-right">Calls</th>
              </tr>
            </thead>
            <tbody>
              {topTools.map((t) => (
                <tr key={t.name} className="border-t border-border/40">
                  <td className="py-2">{t.name}</td>
                  <td className="py-2 text-right tabular-nums">{INT.format(t.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Recent sessions</CardTitle>
        </CardHeader>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2">When</th>
              <th className="pb-2">Source</th>
              <th className="pb-2">Model</th>
              <th className="pb-2">Project</th>
              <th className="pb-2 text-right">Duration</th>
              <th className="pb-2 text-right">Tokens</th>
              <th className="pb-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((s) => (
              <tr key={`${s.source}:${s.id}`} className="border-t border-border/40">
                <td className="py-2 text-xs text-muted-foreground">{s.date || "—"}</td>
                <td className="py-2">
                  <SourceBadge source={s.source} />
                </td>
                <td className="py-2 text-xs font-mono">{s.model || "—"}</td>
                <td className="py-2 text-xs">{s.project || "—"}</td>
                <td className="py-2 text-right tabular-nums text-xs">
                  {s.durationMs ? formatDuration(s.durationMs) : "—"}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {TOK.format(s.inputTokens + s.outputTokens)}
                </td>
                <td className="py-2 text-right tabular-nums">{USD.format(s.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent billing blocks (5-hour windows)</CardTitle>
        </CardHeader>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2">Start (UTC)</th>
              <th className="pb-2">Models</th>
              <th className="pb-2 text-right">Entries</th>
              <th className="pb-2 text-right">Tokens</th>
              <th className="pb-2 text-right">Cost</th>
              <th className="pb-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {recentBlocks.map((b) => {
              const tokens =
                b.inputTokens + b.outputTokens + b.cacheReadTokens + b.cacheCreateTokens;
              return (
                <tr key={b.startMs} className="border-t border-border/40">
                  <td className="py-2 text-xs text-muted-foreground">
                    {new Date(b.startMs).toISOString().slice(0, 16).replace("T", " ")}Z
                  </td>
                  <td className="py-2 text-xs font-mono">{b.models.slice(0, 2).join(", ")}</td>
                  <td className="py-2 text-right tabular-nums">{INT.format(b.entryCount)}</td>
                  <td className="py-2 text-right tabular-nums">{TOK.format(tokens)}</td>
                  <td className="py-2 text-right tabular-nums">{USD.format(b.cost)}</td>
                  <td className="py-2 text-right text-xs">
                    {b.isActive ? (
                      <Badge className="text-emerald-500">active</Badge>
                    ) : (
                      <span className="text-muted-foreground">done</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {cursorRaw && cursorRaw.sessions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SourceBadge source="cursor" /> Cursor detail
            </CardTitle>
          </CardHeader>
          <p className="text-xs text-muted-foreground">
            Cursor&apos;s SQLite doesn&apos;t expose per-project attribution, so these sessions
            don&apos;t appear in the cross-source project table. This panel surfaces everything
            Cursor does report.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <div className="text-xs text-muted-foreground">Sessions</div>
              <div className="text-2xl font-semibold tabular-nums">
                {INT.format(cursorRaw.sessions.length)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Messages</div>
              <div className="text-2xl font-semibold tabular-nums">
                {INT.format(cursorRaw.totalMessages)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Lines added</div>
              <div className="text-2xl font-semibold tabular-nums text-emerald-400">
                +{INT.format(cursorRaw.totalLinesAdded)}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                −{INT.format(cursorRaw.totalLinesRemoved)} removed
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Files created</div>
              <div className="text-2xl font-semibold tabular-nums">
                {INT.format(cursorRaw.totalFilesCreated)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Tab accept rate</div>
              <div className="text-2xl font-semibold tabular-nums">
                {PCT.format(cursorTabAcceptRate)}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {INT.format(cursorRaw.totalTabAcceptedLines)} /{" "}
                {INT.format(cursorRaw.totalTabSuggestedLines)} lines
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Composer accept rate</div>
              <div className="text-2xl font-semibold tabular-nums">
                {PCT.format(cursorComposerAcceptRate)}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {INT.format(cursorRaw.totalComposerAcceptedLines)} /{" "}
                {INT.format(cursorRaw.totalComposerSuggestedLines)} lines
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Thinking time</div>
              <div className="text-2xl font-semibold tabular-nums">
                {formatDuration(cursorRaw.thinkingTimeMs)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Tool calls</div>
              <div className="text-2xl font-semibold tabular-nums">
                {INT.format(cursorRaw.totalToolCalls)}
              </div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {INT.format(cursorRaw.totalToolErrors)} errors
              </div>
            </div>
          </div>

          <h4 className="mt-6 mb-2 text-xs uppercase tracking-wide text-muted-foreground">
            Recent Cursor sessions
          </h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2">When</th>
                <th className="pb-2">Model</th>
                <th className="pb-2">Mode</th>
                <th className="pb-2 text-right">Messages</th>
                <th className="pb-2 text-right">+Lines</th>
                <th className="pb-2 text-right">−Lines</th>
              </tr>
            </thead>
            <tbody>
              {recentCursor.map((s) => (
                <tr key={s.sessionId} className="border-t border-border/40">
                  <td className="py-2 text-xs text-muted-foreground">{s.createdAt || "—"}</td>
                  <td className="py-2 text-xs font-mono">{s.model || "—"}</td>
                  <td className="py-2 text-xs">{s.mode || "—"}</td>
                  <td className="py-2 text-right tabular-nums">{INT.format(s.messageCount)}</td>
                  <td className="py-2 text-right tabular-nums text-emerald-400">
                    +{INT.format(s.linesAdded)}
                  </td>
                  <td className="py-2 text-right tabular-nums text-red-400/80">
                    −{INT.format(s.linesRemoved)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3 text-sm">
        <Card>
          <CardHeader>
            <CardTitle>Claude</CardTitle>
          </CardHeader>
          <div className="space-y-1">
            <div>
              <span className="text-muted-foreground">Sessions: </span>
              <span className="tabular-nums">{INT.format(claude?.sessions ?? 0)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Cost: </span>
              <span className="tabular-nums">{USD.format(claude?.cost ?? 0)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Active days: </span>
              <span className="tabular-nums">{INT.format(claude?.activeDays ?? 0)}</span>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Codex</CardTitle>
          </CardHeader>
          <div className="space-y-1">
            <div>
              <span className="text-muted-foreground">Sessions: </span>
              <span className="tabular-nums">{INT.format(codex?.sessions ?? 0)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Cost: </span>
              <span className="tabular-nums">{USD.format(codex?.cost ?? 0)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Active days: </span>
              <span className="tabular-nums">{INT.format(codex?.activeDays ?? 0)}</span>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cursor</CardTitle>
          </CardHeader>
          <div className="space-y-1">
            <div>
              <span className="text-muted-foreground">Sessions: </span>
              <span className="tabular-nums">{INT.format(cursor?.sessions ?? 0)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Cost: </span>
              <span className="tabular-nums">subscription</span>
            </div>
            <div>
              <span className="text-muted-foreground">Active days: </span>
              <span className="tabular-nums">{INT.format(cursor?.activeDays ?? 0)}</span>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
