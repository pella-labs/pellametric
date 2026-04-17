import { getTwoByTwo, listTeams } from "@bematist/api";
import {
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardValue,
  ChartTableToggle,
  FidelityChip,
  type GateReason,
  InsufficientData,
  ScatterChart,
} from "@bematist/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getSessionCtx } from "@/lib/session";

export const metadata: Metadata = {
  title: "Teams",
};

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; cat?: string }>;
}) {
  const ctx = await getSessionCtx();
  const { team: selectedParam, cat } = await searchParams;
  const teamsList = await listTeams(ctx, { window: "30d" });

  const eligible = teamsList.teams.find((t) => t.cohort_size >= 5);
  const selectedId =
    selectedParam && teamsList.teams.some((t) => t.id === selectedParam)
      ? selectedParam
      : (eligible?.id ?? teamsList.teams[0]?.id ?? "team_growth");
  const selected = teamsList.teams.find((t) => t.id === selectedId);

  const twoByTwo = await getTwoByTwo(ctx, {
    window: "30d",
    team_id: selectedId,
    ...(cat ? { task_category: cat } : {}),
  });

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
        <p className="text-sm text-muted-foreground">
          Cohort-stratified view. IC names are always hidden — each dot is a stable hash. Names only
          unlock via explicit IC opt-in.
        </p>
      </header>

      <section aria-labelledby="teams-list" className="flex flex-col gap-3">
        <h2
          id="teams-list"
          className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
        >
          {teamsList.teams.length} team{teamsList.teams.length === 1 ? "" : "s"} · 30-day window
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {teamsList.teams.map((t) => {
            const isSelected = t.id === selectedId;
            return (
              <Link
                key={t.id}
                href={{ pathname: "/teams", query: { team: t.id, ...(cat ? { cat } : {}) } }}
                aria-current={isSelected ? "true" : undefined}
                className={
                  isSelected
                    ? "block cursor-pointer rounded-xl border border-primary bg-card p-5 outline outline-1 -outline-offset-1 outline-primary/40"
                    : "block cursor-pointer rounded-xl border border-border bg-card p-5 transition-colors hover:border-muted-foreground"
                }
              >
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <p className="text-base font-semibold">{t.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.engineers} engineer{t.engineers === 1 ? "" : "s"}
                    </p>
                  </div>
                  <FidelityChip fidelity={t.fidelity} />
                </div>
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Cost · 30d</dt>
                    <dd className="mt-0.5 text-sm font-medium">{USD.format(t.cost_usd)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">AI Leverage</dt>
                    <dd className="mt-0.5 text-sm font-medium">
                      {t.ai_leverage_score.show ? (
                        t.ai_leverage_score.value.toFixed(0)
                      ) : (
                        <InsufficientData
                          reason={t.ai_leverage_score.suppression_reason as GateReason}
                        />
                      )}
                    </dd>
                  </div>
                </dl>
              </Link>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="two-by-two" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2
            id="two-by-two"
            className="text-sm font-medium uppercase tracking-wide text-muted-foreground"
          >
            2×2 · {selected?.label ?? "Team"} · Outcome Quality × Efficiency
          </h2>
          <TaskCategoryFilter
            selectedTeam={selectedId}
            current={twoByTwo.task_category}
            available={twoByTwo.available_task_categories}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Cohort-stratified scatter</CardTitle>
            <p className="text-xs text-muted-foreground">
              X = Outcome Quality percentile · Y = Efficiency percentile · dot size = sessions ·
              cohort k = {twoByTwo.cohort_size}
            </p>
          </CardHeader>
          {twoByTwo.display.show ? (
            <ChartTableToggle
              chart={
                <ScatterChart
                  data={twoByTwo.points.map((p) => ({
                    id: p.engineer_id_hash,
                    x: p.outcome_quality,
                    y: p.efficiency,
                    z: p.sessions,
                  }))}
                  xLabel="Outcome Quality (percentile)"
                  yLabel="Efficiency (percentile)"
                  ariaLabel={`2×2 scatter for ${selected?.label ?? "team"}`}
                />
              }
              table={<ScatterTable points={twoByTwo.points} />}
            />
          ) : (
            <div className="flex min-h-[220px] items-center justify-center py-6">
              <InsufficientData
                reason={
                  twoByTwo.display.suppression_reason === "k_anonymity_floor"
                    ? "k_anonymity_floor"
                    : (twoByTwo.display.suppression_reason as GateReason)
                }
              >
                <span>
                  Insufficient cohort — k={twoByTwo.cohort_size} is below the 5-person floor. Names
                  and dots are both suppressed.
                </span>
              </InsufficientData>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

function TaskCategoryFilter({
  selectedTeam,
  current,
  available,
}: {
  selectedTeam: string;
  current: string | null;
  available: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Link href={{ pathname: "/teams", query: { team: selectedTeam } }} className="cursor-pointer">
        <Badge tone={current === null ? "accent" : "neutral"}>All tasks</Badge>
      </Link>
      {available.map((c) => {
        const isCurrent = c === current;
        return (
          <Link
            key={c}
            href={{ pathname: "/teams", query: { team: selectedTeam, cat: c } }}
            className="cursor-pointer"
          >
            <Badge tone={isCurrent ? "accent" : "neutral"}>{formatCat(c)}</Badge>
          </Link>
        );
      })}
    </div>
  );
}

function formatCat(c: string): string {
  return c.replace(/_/g, " ");
}

function ScatterTable({
  points,
}: {
  points: {
    engineer_id_hash: string;
    outcome_quality: number;
    efficiency: number;
    sessions: number;
    cost_usd: number;
  }[];
}) {
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-muted-foreground">
        <tr className="border-b border-border">
          <th className="py-2 font-medium">Engineer</th>
          <th className="py-2 text-right font-medium">Outcome</th>
          <th className="py-2 text-right font-medium">Efficiency</th>
          <th className="py-2 text-right font-medium">Sessions</th>
          <th className="py-2 text-right font-medium">Cost</th>
        </tr>
      </thead>
      <tbody>
        {points.map((p) => (
          <tr key={p.engineer_id_hash} className="border-b border-border/50">
            <td className="py-2 font-mono text-xs">{p.engineer_id_hash}</td>
            <td className="py-2 text-right">{p.outcome_quality.toFixed(0)}</td>
            <td className="py-2 text-right">{p.efficiency.toFixed(0)}</td>
            <td className="py-2 text-right">{p.sessions}</td>
            <td className="py-2 text-right">{USD.format(p.cost_usd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
