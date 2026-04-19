import { AreaChart, Card, CardHeader, CardTitle, CardValue, ScatterChart } from "@bematist/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { SourceBadge } from "@/components/SourceBadge";
import type { LocalData } from "@/lib/local-sources";
import { type Engineer, getAllEngineerData, getEngineerData } from "@/lib/peers";

export const metadata: Metadata = {
  title: "Team",
};

export const dynamic = "force-dynamic";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const INT = new Intl.NumberFormat("en-US");
const TOK = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const PCT = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

/** Return percentile-rank (0–100) of each value within the input array. */
function percentileRank(values: number[]): number[] {
  if (values.length === 0) return [];
  const pairs = values.map((v, i) => ({ v, i }));
  pairs.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length).fill(0);
  for (let i = 0; i < pairs.length; i++) {
    let j = i;
    while (j + 1 < pairs.length && pairs[j + 1]?.v === pairs[i]?.v) j++;
    const avgIdx = (i + j) / 2;
    const pct = values.length === 1 ? 50 : Math.round((avgIdx / (values.length - 1)) * 100);
    for (let k = i; k <= j; k++) {
      const pr = pairs[k];
      if (pr) ranks[pr.i] = pct;
    }
    i = j;
  }
  return ranks;
}

function EngineerChipRow({
  engineers,
  current,
  cohortSize,
}: {
  engineers: { engineer: Engineer; online: boolean }[];
  current: string;
  cohortSize: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Engineer:</span>
      <Link
        href="/teams"
        className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 ${
          current === "__cohort"
            ? "border-primary/40 bg-primary/15 text-foreground"
            : "border-transparent hover:border-border text-muted-foreground"
        }`}
      >
        Cohort view
      </Link>
      {engineers.map(({ engineer: e, online }) => (
        <Link
          key={e.id}
          href={`/teams?engineer=${encodeURIComponent(e.id)}`}
          className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 ${
            current === e.id
              ? "border-primary/40 bg-primary/15"
              : "border-transparent hover:border-border"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${online ? "bg-primary" : "bg-muted-foreground/40"}`}
          />
          <span>{e.name}</span>
          {!online ? <span className="text-muted-foreground">(offline)</span> : null}
          {e.kind === "peer" ? (
            <span className="text-muted-foreground" title={e.url}>
              peer
            </span>
          ) : null}
        </Link>
      ))}
      <span className="ml-auto text-muted-foreground">
        cohort k={cohortSize} · k≥5 for named rankings
      </span>
    </div>
  );
}

// ── Per-engineer view ─────────────────────────────────────────

function EngineerView({
  engineer,
  data,
  online,
}: {
  engineer: Engineer;
  data: LocalData | null;
  online: boolean;
}) {
  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{engineer.name} — no data</CardTitle>
        </CardHeader>
        <p className="text-sm text-muted-foreground">
          {online
            ? "This peer is reachable but hasn't returned any data yet."
            : `Peer not reachable at ${engineer.url}. Snapshot API returns 503 if BEMATIST_PEER_SECRET isn't set on the peer, or 401 if our secret doesn't match.`}
        </p>
      </Card>
    );
  }
  const { analytics, sources } = data;
  const daily = analytics.dailyCosts.map((d) => ({ x: d.date, y: d.cost }));
  const topModels = [...analytics.modelBreakdowns].sort((a, b) => b.cost - a.cost).slice(0, 10);
  const topProjects = [...analytics.projectBreakdowns].sort((a, b) => b.cost - a.cost).slice(0, 8);

  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`h-2 w-2 rounded-full ${online ? "bg-primary" : "bg-muted-foreground/40"}`}
            />
            <span className="font-semibold">{engineer.name}</span>
            {engineer.kind === "peer" ? (
              <span className="font-mono text-xs text-muted-foreground">{engineer.url}</span>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground">
            Tier B data — aggregates only, prompt text stays on the engineer&apos;s machine.
          </span>
        </div>
      </Card>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Total cost</CardTitle>
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
            avg {USD.format(analytics.totalCost / Math.max(1, analytics.totalSessions))} / session
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
            {INT.format(analytics.retryStats.retriedTurns)} retried turns
          </p>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Cost by day</CardTitle>
        </CardHeader>
        <AreaChart data={daily} format="currency" ariaLabel="Cost per day" height={220} />
      </Card>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By source</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2">Source</th>
                  <th className="pb-2 text-right">Sessions</th>
                  <th className="pb-2 text-right">Tokens</th>
                  <th className="pb-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) =>
                  s.sessions === 0 ? null : (
                    <tr key={s.key} className="border-t border-border/40">
                      <td className="py-2">
                        <SourceBadge source={s.key} />
                      </td>
                      <td className="py-2 text-right tabular-nums">{INT.format(s.sessions)}</td>
                      <td className="py-2 text-right tabular-nums">{TOK.format(s.tokens)}</td>
                      <td className="py-2 text-right tabular-nums">
                        {s.costLabel ?? USD.format(s.cost)}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top models by cost</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2">Model</th>
                  <th className="pb-2 text-right">Sessions</th>
                  <th className="pb-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {topModels.map((m) => (
                  <tr key={`${m.provider}:${m.model}`} className="border-t border-border/40">
                    <td className="py-2">
                      <div className="font-mono">{m.model}</div>
                      <div className="text-xs text-muted-foreground">{m.provider}</div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{INT.format(m.sessionCount)}</td>
                    <td className="py-2 text-right tabular-nums">{USD.format(m.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Top projects by cost</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2">Project</th>
                <th className="pb-2">Sources</th>
                <th className="pb-2 text-right">Sessions</th>
                <th className="pb-2 text-right">Tokens</th>
                <th className="pb-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {topProjects.map((p) => (
                <tr key={p.project} className="border-t border-border/40">
                  <td className="py-2">{p.displayName}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {p.sources.map((src) => (
                        <SourceBadge key={src} source={src} size="xs" />
                      ))}
                    </div>
                  </td>
                  <td className="py-2 text-right tabular-nums">{INT.format(p.sessions)}</td>
                  <td className="py-2 text-right tabular-nums">{TOK.format(p.tokens)}</td>
                  <td className="py-2 text-right tabular-nums">{USD.format(p.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ── Cohort view (multi-engineer) ──────────────────────────────

function CohortView({
  entries,
}: {
  entries: { engineer: Engineer; data: LocalData | null; online: boolean }[];
}) {
  const engineers = entries.filter((e) => e.data !== null);
  if (engineers.length < 2) {
    return <ProjectProxyCohort entries={entries} />;
  }

  const totalCost = engineers.reduce((a, e) => a + (e.data?.analytics.totalCost ?? 0), 0);
  const totalSessions = engineers.reduce((a, e) => a + (e.data?.analytics.totalSessions ?? 0), 0);

  const firstTryRanks = percentileRank(
    engineers.map((e) => e.data?.analytics.retryStats.firstTryRate ?? 0),
  );
  const efficiencyRanks = percentileRank(
    engineers.map((e) => {
      const d = e.data;
      if (!d || d.analytics.totalCost === 0) return 0;
      return d.analytics.totalSessions / d.analytics.totalCost;
    }),
  );
  const scatter = engineers.map((e, i) => ({
    id: e.engineer.id,
    x: firstTryRanks[i] ?? 50,
    y: efficiencyRanks[i] ?? 50,
    z: Math.max(6, Math.log10((e.data?.analytics.totalCost ?? 1) + 1) * 25),
  }));

  return (
    <>
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <p className="text-xs text-emerald-400/90">
          <strong>{engineers.length}-engineer cohort.</strong> This is the real team view — each dot
          on the 2×2 below is a teammate, names are shown because it&apos;s just
          {` ${engineers.length}`} of you (below k=5). Prompt text is NEVER in this data; each
          peer&apos;s <code className="font-mono">/api/peer/snapshot</code> returns grammata
          aggregates only (CLAUDE.md §Privacy Rules Tier B).
        </p>
      </Card>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Engineers</CardTitle>
          </CardHeader>
          <CardValue>{engineers.length}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            {entries.length - engineers.length} offline
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Total spend</CardTitle>
          </CardHeader>
          <CardValue>{USD.format(totalCost)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">across cohort</p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Total sessions</CardTitle>
          </CardHeader>
          <CardValue>{INT.format(totalSessions)}</CardValue>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>k-anonymity</CardTitle>
          </CardHeader>
          <CardValue>
            k={engineers.length}
            {engineers.length >= 5 ? " ✓" : ""}
          </CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            {engineers.length >= 5
              ? "named rankings unlocked"
              : `need ${5 - engineers.length} more for named rankings`}
          </p>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Engineers — per-member rollup</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[32rem]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2">Engineer</th>
                <th className="pb-2">Status</th>
                <th className="pb-2 text-right">Sessions</th>
                <th className="pb-2 text-right">First-try</th>
                <th className="pb-2 text-right">Tokens</th>
                <th className="pb-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(({ engineer, data, online }) => (
                <tr key={engineer.id} className="border-t border-border/40">
                  <td className="py-2">
                    <Link
                      href={`/teams?engineer=${encodeURIComponent(engineer.id)}`}
                      className="inline-flex items-center gap-1.5 hover:underline"
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          online ? "bg-primary" : "bg-muted-foreground/40"
                        }`}
                      />
                      <span>{engineer.name}</span>
                    </Link>
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {online ? "online" : "offline"} · {engineer.kind}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {data ? INT.format(data.analytics.totalSessions) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {data ? PCT.format(data.analytics.retryStats.firstTryRate) : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {data
                      ? TOK.format(
                          data.analytics.totalInputTokens + data.analytics.totalOutputTokens,
                        )
                      : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {data ? USD.format(data.analytics.totalCost) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2×2 — outcome quality × efficiency (engineers as dots)</CardTitle>
        </CardHeader>
        <p className="mb-2 text-xs text-muted-foreground">
          X: first-try rate rank. Y: sessions-per-dollar rank. Bubble size ∝ log(cost). Upper-right
          = healthy; lower-left = "why is this engineer so expensive AND broken?"
        </p>
        <ScatterChart
          data={scatter}
          xLabel="First-try rank (percentile)"
          yLabel="Efficiency rank (percentile)"
          threshold={{ x: 50, y: 50 }}
          ariaLabel="Engineers plotted by first-try rank vs. efficiency rank"
          height={320}
        />
      </Card>
    </>
  );
}

function ProjectProxyCohort({
  entries,
}: {
  entries: { engineer: Engineer; data: LocalData | null; online: boolean }[];
}) {
  const me = entries.find((e) => e.engineer.kind === "me");
  const analytics = me?.data?.analytics;
  if (!analytics) {
    return (
      <Card>
        <p className="text-sm text-muted-foreground">No local data yet.</p>
      </Card>
    );
  }

  const projRetry = new Map<string, { retried: number; total: number }>();
  for (const s of analytics.sessionRows) {
    const key = s.project || "(unknown)";
    const cur = projRetry.get(key) ?? { retried: 0, total: 0 };
    cur.total += 1;
    if (s.retryCount > 0) cur.retried += 1;
    projRetry.set(key, cur);
  }

  const rows = analytics.projectBreakdowns.map((p) => {
    const r = projRetry.get(p.project) ?? { retried: 0, total: 0 };
    const firstTryRate = r.total > 0 ? 1 - r.retried / r.total : 1;
    return { ...p, firstTryRate, retriedSessions: r.retried, totalSessions: r.total };
  });

  const scatterSource = rows.filter((r) => r.cost > 0 && r.sessions > 0);
  const firstTryRanked = percentileRank(scatterSource.map((r) => r.firstTryRate));
  const effRanked = percentileRank(scatterSource.map((r) => r.sessions / r.cost));
  const scatter = scatterSource.map((r, i) => ({
    id: r.project,
    x: firstTryRanked[i] ?? 50,
    y: effRanked[i] ?? 50,
    z: Math.max(4, Math.log10(r.cost + 1) * 20),
  }));

  const avgFirstTryRate =
    rows.reduce((a, r) => a + r.firstTryRate * r.totalSessions, 0) /
    Math.max(
      1,
      rows.reduce((a, r) => a + r.totalSessions, 0),
    );

  const sortedByCost = [...rows].sort((a, b) => b.cost - a.cost).slice(0, 10);
  const sortedByRetry = [...rows]
    .filter((r) => r.totalSessions >= 3)
    .sort((a, b) => a.firstTryRate - b.firstTryRate)
    .slice(0, 10);

  return (
    <>
      <Card className="border-amber-500/30 bg-amber-500/5">
        <p className="text-xs text-amber-400/90">
          <strong>Single-engineer local mode.</strong> Only 1 engineer configured (
          {entries.length > 1 ? `${entries.length - 1} peer(s) offline` : "no peers configured"}).
          Projects stand in as proxy cohort members so the layout is real. Configure peers via the{" "}
          <code className="font-mono">BEMATIST_PEERS</code> env var to unlock engineer dots on the
          2×2.
        </p>
      </Card>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Engineers</CardTitle>
          </CardHeader>
          <CardValue>1</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">k=5 floor for team tiles</p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Projects (proxy)</CardTitle>
          </CardHeader>
          <CardValue>{INT.format(rows.length)}</CardValue>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Total spend</CardTitle>
          </CardHeader>
          <CardValue>{USD.format(rows.reduce((a, r) => a + r.cost, 0))}</CardValue>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>First-try rate</CardTitle>
          </CardHeader>
          <CardValue>{PCT.format(avgFirstTryRate)}</CardValue>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>2×2 (projects as proxy cohort)</CardTitle>
        </CardHeader>
        <ScatterChart
          data={scatter}
          xLabel="First-try rank (percentile)"
          yLabel="Efficiency rank (percentile)"
          threshold={{ x: 50, y: 50 }}
          ariaLabel="Projects plotted by first-try rank vs. efficiency rank"
          height={320}
        />
      </Card>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top projects by spend</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[28rem]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2">Project</th>
                  <th className="pb-2 text-right">Sessions</th>
                  <th className="pb-2 text-right">First-try</th>
                  <th className="pb-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {sortedByCost.map((p) => (
                  <tr key={p.project} className="border-t border-border/40">
                    <td className="py-2 text-xs truncate max-w-[14rem]">{p.displayName}</td>
                    <td className="py-2 text-right tabular-nums">{INT.format(p.sessions)}</td>
                    <td className="py-2 text-right tabular-nums text-xs">
                      {PCT.format(p.firstTryRate)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{USD.format(p.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lowest first-try rate</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[28rem]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2">Project</th>
                  <th className="pb-2 text-right">Sessions</th>
                  <th className="pb-2 text-right">Retried</th>
                  <th className="pb-2 text-right">First-try</th>
                </tr>
              </thead>
              <tbody>
                {sortedByRetry.map((p) => (
                  <tr key={p.project} className="border-t border-border/40">
                    <td className="py-2 text-xs truncate max-w-[14rem]">{p.displayName}</td>
                    <td className="py-2 text-right tabular-nums">{INT.format(p.totalSessions)}</td>
                    <td className="py-2 text-right tabular-nums text-red-400/80">
                      {INT.format(p.retriedSessions)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-xs text-amber-400">
                      {PCT.format(p.firstTryRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ engineer?: string }>;
}) {
  const sp = await searchParams;
  const selected = sp.engineer ?? "__cohort";

  const allEntries = await getAllEngineerData();
  const onlineCount = allEntries.filter((e) => e.online && e.data).length;

  const chipData = allEntries.map((e) => ({ engineer: e.engineer, online: e.online }));

  let body: React.ReactNode;
  if (selected === "__cohort") {
    body = <CohortView entries={allEntries} />;
  } else {
    const selectedEntry =
      allEntries.find((e) => e.engineer.id === selected) ??
      (await (async () => {
        const { data, online, engineer } = await getEngineerData(selected);
        return { engineer, data, online };
      })());
    body = (
      <EngineerView
        engineer={selectedEntry.engineer}
        data={selectedEntry.data}
        online={selectedEntry.online}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">
          Every teammate&apos;s dashboard exposes an authed{" "}
          <code className="font-mono text-xs">/api/peer/snapshot</code> endpoint that returns
          grammata aggregates — no prompt text. This page pulls from every configured peer and
          renders the cohort, or a single engineer&apos;s full breakdown when you pick one.
        </p>
        <EngineerChipRow engineers={chipData} current={selected} cohortSize={onlineCount} />
      </header>

      {body}

      <Card>
        <CardHeader>
          <CardTitle>Privacy boundary</CardTitle>
        </CardHeader>
        <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-5">
          <li>
            <strong className="text-foreground">No prompts cross the wire.</strong>{" "}
            <code className="font-mono text-xs">/api/peer/snapshot</code> returns only
            grammata&apos;s aggregate object: session counts, tokens, cost, tool counts, retry
            ratios, model/project/branch rollups. Zero message text.
          </li>
          <li>
            <strong className="text-foreground">Session transcripts stay local.</strong> The{" "}
            <code className="font-mono text-xs">/sessions/[source]/[id]</code> detail page reads raw
            JSONL from the IC&apos;s disk — peers can&apos;t reach it, no network path exists.
          </li>
          <li>
            <strong className="text-foreground">Bearer auth, not public.</strong>{" "}
            <code className="font-mono text-xs">BEMATIST_PEER_SECRET</code> on the serving side +
            per-peer secrets in <code className="font-mono text-xs">BEMATIST_PEERS</code> on the
            consuming side. Intended for Tailscale / VPN deploys.
          </li>
          <li>
            <strong className="text-foreground">Tier-B default.</strong> This matches CLAUDE.md
            §Privacy Rules D7 — counters + redacted envelopes, works-council compatible. Tier C
            (prompt text) would need an additional IC opt-in flow that is <em>not</em> wired here;
            peer endpoint never upgrades.
          </li>
        </ul>
      </Card>
    </div>
  );
}
