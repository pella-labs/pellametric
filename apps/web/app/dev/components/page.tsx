// F1.10 — Component showcase for design eval. Renders every chart + data
// primitive with mock data. Env-gated: only visible when NODE_ENV !== production
// OR DEV_AUTH_BYPASS=1. Returns 404 otherwise so the route can't be hit on prod.

import { notFound } from "next/navigation";
import { SankeyChart } from "@/components/charts/sankey-chart";
import { ScatterChart } from "@/components/charts/scatter-chart";
import { CalendarHeatmap } from "@/components/charts/calendar-heatmap";
import { SourceBar } from "@/components/data/source-bar";
import { SourceChip } from "@/components/data/source-chip";
import { ConfidencePip } from "@/components/data/confidence-pip";
import { ConfidencePipLarge } from "@/components/data/confidence-pip-large";
import { KpiTile } from "@/components/data/kpi-tile";
import { Sparkline } from "@/components/data/sparkline";
import { EmptyState } from "@/components/data/empty-state";
import {
  SkeletonBox,
  SkeletonText,
  SkeletonTable,
  SkeletonKpiTile,
  SkeletonChart,
} from "@/components/data/skeleton";

export const dynamic = "force-dynamic";

function isAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.DEV_AUTH_BYPASS === "1";
}

const sankeyNodes = [
  { id: "s-build", label: "build", kind: "session" as const, source: "claude" as const },
  { id: "s-debug", label: "debug", kind: "session" as const, source: "codex" as const },
  { id: "s-refactor", label: "refactor", kind: "session" as const, source: "cursor" as const },
  { id: "c-pellametric", label: "9 commits — pellametric", kind: "commit" as const },
  { id: "c-revamp", label: "3 commits — revamp", kind: "commit" as const },
  { id: "c-orphan", label: "1 commit — orphan", kind: "commit" as const },
  { id: "pr-142", label: "#142 merged", kind: "pr" as const },
  { id: "pr-138", label: "#138 merged", kind: "pr" as const },
  { id: "pr-145", label: "#145 open", kind: "pr" as const },
];

const sankeyLinks = [
  { source: "s-build", target: "c-pellametric", value: 240 },
  { source: "s-debug", target: "c-pellametric", value: 80 },
  { source: "s-debug", target: "c-revamp", value: 120 },
  { source: "s-refactor", target: "c-revamp", value: 40 },
  { source: "s-refactor", target: "c-orphan", value: 25 },
  { source: "c-pellametric", target: "pr-142", value: 320 },
  { source: "c-revamp", target: "pr-138", value: 160 },
  { source: "c-orphan", target: "pr-145", value: 25 },
];

const scatterPoints = Array.from({ length: 16 }).map((_, i) => ({
  id: `dev-${i}`,
  label: `dev${i}`,
  x: 30 + Math.random() * 280, // spend ($)
  y: 1 + Math.random() * 12, // merged PRs
  sessions: 6 + Math.floor(Math.random() * 40),
  source: ["claude", "codex", "cursor", "human"][i % 4] as
    | "claude"
    | "codex"
    | "cursor"
    | "human",
}));

const heatmapCells = (() => {
  const out: { day: string; value: number }[] = [];
  const today = new Date();
  for (let i = 0; i < 84; i++) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const k = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    // Weekends 0, weekdays varied.
    out.push({
      day: k,
      value:
        dow === 0 || dow === 6
          ? Math.random() < 0.85
            ? 0
            : 1 + Math.floor(Math.random() * 3)
          : Math.floor(Math.random() * 12),
    });
  }
  return out;
})();

export default function DevComponentsPage(): React.ReactElement {
  if (!isAllowed()) notFound();
  return (
    <div className="min-h-screen bg-(--background) text-(--foreground) p-8 space-y-12">
      <header className="space-y-2">
        <p className="mk-eyebrow">_dev / components</p>
        <h1 className="mk-heading text-3xl">Pellametric chart + data primitives</h1>
        <p className="mk-table-cell text-(--muted-foreground) max-w-2xl">
          Showcase route for visual review of every Visx-backed and pure-SVG primitive
          shipped in Phase F1. Env-gated: not visible on prod.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="mk-label">KPI tiles</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile
            label="Cost / merged PR"
            value="$24.18"
            caption="last 30 days"
            delta={{ pct: -8.2 }}
            goodDirection="down"
            sparkline={[30, 28, 31, 26, 24, 26, 25, 23, 22, 24]}
            sparklineTone="positive"
          />
          <KpiTile
            label="Team spend"
            value="$2,431"
            caption="last 30 days"
            delta={{ pct: 12.4 }}
            goodDirection="down"
            sparkline={[160, 180, 220, 195, 240, 230, 260, 245, 260, 280]}
            sparklineTone="warning"
          />
          <KpiTile
            label="Merged PRs"
            value="184"
            caption="last 30 days"
            delta={{ pct: 18.0 }}
            goodDirection="up"
            sparkline={[10, 12, 11, 14, 16, 13, 18, 17, 19, 20]}
            sparklineTone="positive"
          />
          <KpiTile
            label="Waste %"
            value="9.6%"
            caption="last 30 days"
            delta={{ pct: -1.4 }}
            goodDirection="down"
            sparkline={[12, 11, 13, 14, 11, 10, 11, 10, 10, 9]}
            sparklineTone="positive"
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="mk-label">Sankey — session → commit → PR</h2>
        <div className="mk-panel">
          <SankeyChart nodes={sankeyNodes} links={sankeyLinks} width={900} height={320} />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="mk-label">Scatter — spend × throughput</h2>
        <div className="mk-panel">
          <ScatterChart
            points={scatterPoints}
            width={900}
            height={360}
            xLabel="$ spent (30d)"
            yLabel="Merged PRs"
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="mk-label">Calendar heatmap — last 12 weeks</h2>
        <div className="mk-panel">
          <CalendarHeatmap cells={heatmapCells} metricLabel="sessions" />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="mk-label">Attribution bar + source chips + confidence pips</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="mk-panel">
            <p className="mk-eyebrow mb-3">Attribution mix</p>
            <SourceBar pctClaude={41} pctCodex={22} pctCursor={14} pctHuman={23} />
          </div>
          <div className="mk-panel space-y-3">
            <p className="mk-eyebrow">Source chips</p>
            <div className="flex flex-wrap gap-3">
              <SourceChip kind="claude" showLabel />
              <SourceChip kind="codex" showLabel />
              <SourceChip kind="cursor" showLabel />
              <SourceChip kind="human" showLabel />
            </div>
            <p className="mk-eyebrow mt-4">Confidence pips (inline)</p>
            <div className="flex flex-wrap gap-3">
              <ConfidencePip confidence="high" />
              <ConfidencePip confidence="medium" />
              <ConfidencePip confidence="low" />
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="mk-label">Confidence pip — page-level (PR detail)</h2>
        <div className="space-y-3">
          <ConfidencePipLarge
            confidence="high"
            scorePct={92}
            reason="cwd match + branch match + commit authorship + 0.94 file Jaccard"
          />
          <ConfidencePipLarge
            confidence="medium"
            scorePct={64}
            reason="cwd match + 0.42 file Jaccard; missing branch alignment"
          />
          <ConfidencePipLarge
            confidence="low"
            scorePct={28}
            reason="time overlap only; consider manual relink"
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="mk-label">Sparklines</h2>
        <div className="mk-panel flex items-center gap-6">
          <span className="mk-table-cell">positive </span>
          <Sparkline values={[10, 12, 11, 14, 16, 13, 18, 17, 19, 20]} tone="positive" />
          <span className="mk-table-cell">warning </span>
          <Sparkline values={[30, 28, 31, 33, 36, 38, 35, 39, 41, 44]} tone="warning" />
          <span className="mk-table-cell">neutral </span>
          <Sparkline values={[12, 12, 13, 12, 14, 12, 13, 12, 13, 13]} tone="neutral" />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="mk-label">Empty state (§6.3 — 3 diagnostics + 2 escape hatches)</h2>
        <EmptyState
          headline="Nothing to attribute yet."
          summary="4 devs joined. 2 installed. 0 sessions matched merged PRs (7d)."
          diagnostics={[
            { label: "Collectors not running", cta: { href: "/setup/collector", label: "view setup" } },
            { label: "Sessions linked to repos outside org", cta: { href: "#", label: "review filter" } },
            { label: "No PRs merged this week" },
          ]}
          escapeHatches={[
            { href: "#", label: "Unmatched sessions" },
            { href: "#", label: "All PRs (no attribution)" },
          ]}
        />
      </section>

      <section className="space-y-4">
        <h2 className="mk-label">Skeletons — geometry-matched</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <SkeletonKpiTile />
          <SkeletonKpiTile />
          <SkeletonKpiTile />
          <SkeletonKpiTile />
        </div>
        <div className="mk-panel">
          <SkeletonChart width="100%" height={320} />
        </div>
        <div className="mk-panel">
          <p className="mk-eyebrow mb-2">Table skeleton (h-9 rows)</p>
          <SkeletonTable rows={6} columns="120px 1fr 80px 80px 60px" />
        </div>
        <div className="mk-panel space-y-3">
          <p className="mk-eyebrow">Text + box</p>
          <SkeletonText lines={3} />
          <div className="flex gap-3">
            <SkeletonBox className="h-8 w-24" />
            <SkeletonBox className="h-8 w-32" />
          </div>
        </div>
      </section>
    </div>
  );
}
