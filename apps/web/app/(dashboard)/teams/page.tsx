import { AreaChart, Card, CardHeader, CardTitle, CardValue, ScatterChart } from "@bematist/ui";
import type { Metadata } from "next";
import Link from "next/link";
import {
  type CohortRollup,
  type EngineerRollup,
  getCohort,
  getEngineerDaily,
  getEngineerModels,
} from "@/lib/ch-teams";
import { getSessionCtx } from "@/lib/session";

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
  viewerId,
}: {
  engineers: EngineerRollup[];
  current: string;
  viewerId: string | null;
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
      {engineers.map((e) => {
        const isMe = viewerId === e.id;
        return (
          <Link
            key={e.id}
            href={`/teams?engineer=${encodeURIComponent(e.id)}`}
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 ${
              current === e.id
                ? "border-primary/40 bg-primary/15"
                : "border-transparent hover:border-border"
            }`}
            title={e.id}
          >
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span className="font-mono">{isMe ? "you" : e.shortId}</span>
          </Link>
        );
      })}
      <span className="ml-auto text-muted-foreground">
        cohort k={engineers.length} · k≥5 for named rankings
      </span>
    </div>
  );
}

function CohortView({ cohort, viewerId }: { cohort: CohortRollup; viewerId: string | null }) {
  if (cohort.engineers.length === 0) {
    return (
      <Card className="border-amber-500/30 bg-amber-500/5">
        <p className="text-xs text-amber-400/90">
          <strong>No events in ClickHouse yet.</strong> This team view lights up once any
          teammate&apos;s collector posts to the shared ingest. Check{" "}
          <code className="font-mono">CLICKHOUSE_URL</code> +{" "}
          <code className="font-mono">org_id</code> scope.
        </p>
      </Card>
    );
  }

  const scatterSrc = cohort.engineers.filter((e) => e.cost > 0 && e.sessions > 0);
  const firstTryRanks = percentileRank(scatterSrc.map((e) => e.firstTryRate));
  const effRanks = percentileRank(scatterSrc.map((e) => (e.cost > 0 ? e.sessions / e.cost : 0)));
  const scatter = scatterSrc.map((e, i) => ({
    id: e.shortId,
    x: firstTryRanks[i] ?? 50,
    y: effRanks[i] ?? 50,
    z: Math.max(6, Math.log10(e.cost + 1) * 25),
  }));

  const avgFirstTryRate =
    cohort.engineers.reduce((a, e) => a + e.firstTryRate * e.toolCalls, 0) /
    Math.max(
      1,
      cohort.engineers.reduce((a, e) => a + e.toolCalls, 0),
    );

  return (
    <>
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Engineers</CardTitle>
          </CardHeader>
          <CardValue>{INT.format(cohort.totals.engineers)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            {cohort.totals.engineers >= 5
              ? "named rankings unlocked"
              : `${5 - cohort.totals.engineers} more for named rankings`}
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Total sessions</CardTitle>
          </CardHeader>
          <CardValue>{INT.format(cohort.totals.sessions)}</CardValue>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Total spend</CardTitle>
          </CardHeader>
          <CardValue>{USD.format(cohort.totals.cost)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            avg {USD.format(cohort.totals.cost / Math.max(1, cohort.totals.engineers))} / engineer
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>First-try rate</CardTitle>
          </CardHeader>
          <CardValue>{PCT.format(avgFirstTryRate)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">weighted across tool calls</p>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Engineers — per-member rollup</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[36rem]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2">Engineer</th>
                <th className="pb-2 text-right">Sessions</th>
                <th className="pb-2 text-right">First-try</th>
                <th className="pb-2 text-right">Tokens</th>
                <th className="pb-2 text-right">Cost</th>
                <th className="pb-2 text-right">Active days</th>
              </tr>
            </thead>
            <tbody>
              {cohort.engineers.map((e) => {
                const isMe = viewerId === e.id;
                return (
                  <tr key={e.id} className="border-t border-border/40">
                    <td className="py-2">
                      <Link
                        href={`/teams?engineer=${encodeURIComponent(e.id)}`}
                        className="inline-flex items-center gap-1.5 hover:underline"
                      >
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        <span className="font-mono text-xs">{isMe ? "you" : e.shortId}</span>
                      </Link>
                    </td>
                    <td className="py-2 text-right tabular-nums">{INT.format(e.sessions)}</td>
                    <td className="py-2 text-right tabular-nums">{PCT.format(e.firstTryRate)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {TOK.format(e.inputTokens + e.outputTokens)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{USD.format(e.cost)}</td>
                    <td className="py-2 text-right tabular-nums">{e.activeDays}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {scatter.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>2×2 — outcome quality × efficiency (engineers as dots)</CardTitle>
          </CardHeader>
          <p className="mb-2 text-xs text-muted-foreground">
            X: first-try rate rank. Y: sessions-per-dollar rank. Bubble size ∝ log(cost).
            Upper-right = healthy; lower-left = "why is this engineer so expensive AND broken?"
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
      ) : null}
    </>
  );
}

async function EngineerView({
  engineer,
  tenantId,
  viewerId,
}: {
  engineer: EngineerRollup;
  tenantId: string;
  viewerId: string | null;
}) {
  const [daily, models] = await Promise.all([
    getEngineerDaily(tenantId, engineer.id, 30),
    getEngineerModels(tenantId, engineer.id, 30),
  ]);
  const dailyChart = daily.map((d) => ({ x: d.date, y: d.cost }));
  const isMe = viewerId === engineer.id;

  return (
    <>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-primary" />
            <span className="font-semibold">{isMe ? "you" : engineer.shortId}</span>
            <span className="font-mono text-xs text-muted-foreground">{engineer.id}</span>
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
          <CardValue>{USD.format(engineer.cost)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">last 30 days</p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sessions</CardTitle>
          </CardHeader>
          <CardValue>{INT.format(engineer.sessions)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            avg {USD.format(engineer.cost / Math.max(1, engineer.sessions))} / session
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>First-try rate</CardTitle>
          </CardHeader>
          <CardValue>{PCT.format(engineer.firstTryRate)}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            {INT.format(engineer.toolErrors)} of {INT.format(engineer.toolCalls)} tool calls
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Active days</CardTitle>
          </CardHeader>
          <CardValue>{engineer.activeDays}</CardValue>
          <p className="mt-1 text-xs text-muted-foreground">
            {INT.format(engineer.events)} total events
          </p>
        </Card>
      </section>

      {dailyChart.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Cost by day</CardTitle>
          </CardHeader>
          <AreaChart data={dailyChart} format="currency" ariaLabel="Cost per day" height={220} />
        </Card>
      ) : null}

      {models.length > 0 ? (
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
                {models.map((m) => (
                  <tr key={`${m.provider}:${m.model}`} className="border-t border-border/40">
                    <td className="py-2">
                      <div className="font-mono">{m.model}</div>
                      <div className="text-xs text-muted-foreground">{m.provider}</div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{INT.format(m.sessions)}</td>
                    <td className="py-2 text-right tabular-nums">{USD.format(m.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
}

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ engineer?: string }>;
}) {
  const sp = await searchParams;
  const selected = sp.engineer ?? "__cohort";
  const ctx = await getSessionCtx();
  const viewerId = ctx.actor_id;

  const cohort = await getCohort(ctx.tenant_id, 30);

  let body: React.ReactNode;
  if (selected === "__cohort") {
    body = <CohortView cohort={cohort} viewerId={viewerId} />;
  } else {
    const engineer = cohort.engineers.find((e) => e.id === selected);
    if (!engineer) {
      body = (
        <Card>
          <CardHeader>
            <CardTitle>Engineer not in cohort</CardTitle>
          </CardHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{selected}</span> has no events in the last 30 days.
          </p>
        </Card>
      );
    } else {
      body = <EngineerView engineer={engineer} tenantId={ctx.tenant_id} viewerId={viewerId} />;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">
          Real cohort — every row here is a teammate whose collector has posted to this
          deployment&apos;s ingest. Prompt text never reaches ClickHouse (Tier B at ingest strips it
          by schema); this page can&apos;t show prompts even if it wanted to.
        </p>
        <EngineerChipRow engineers={cohort.engineers} current={selected} viewerId={viewerId} />
      </header>

      {body}

      <Card>
        <CardHeader>
          <CardTitle>Privacy boundary</CardTitle>
        </CardHeader>
        <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-5">
          <li>
            <strong className="text-foreground">No prompts in ClickHouse.</strong> Ingest rejects
            any payload carrying prompt_text, tool args, or file contents with HTTP 400. Server-side
            redactor (TruffleHog + gitleaks + Presidio) runs on everything that gets through. This
            page can only query what&apos;s in the schema — token counts, cost, tool names, statuses
            — no content.
          </li>
          <li>
            <strong className="text-foreground">Per-viewer personal pages.</strong> Each
            teammate&apos;s /insights, /summary, /me/digest queries CH filtered by their own
            engineer_id from the Better Auth session. Same URL, different filtered data per viewer.
          </li>
          <li>
            <strong className="text-foreground">Names vs color dots.</strong> Below k=5, identity
            chips show the first 6 chars of the hashed engineer_id. Above k=5, names only unlock via
            explicit IC opt-in per CLAUDE.md §7.4.
          </li>
          <li>
            <strong className="text-foreground">Transcript stays local.</strong>{" "}
            /sessions/[source]/[id] reads raw JSONL off the IC&apos;s machine — not available on
            shared deploys, no network path exists for peers to reach it.
          </li>
        </ul>
      </Card>
    </div>
  );
}
