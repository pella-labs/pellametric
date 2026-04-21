"use client";
import { useState, useMemo } from "react";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Tooltip, Legend, Filler, Title,
} from "chart.js";
import { Line, Bar, Doughnut } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Tooltip, Legend, Filler, Title);
ChartJS.defaults.color = "rgba(237, 232, 222, 0.5)";
ChartJS.defaults.borderColor = "rgba(237, 232, 222, 0.08)";
ChartJS.defaults.font.family = "var(--font-mono), JetBrains Mono, ui-monospace, monospace";
ChartJS.defaults.font.size = 11;

// Single-hue sage ramp (bematist) + warm amber for secondary, ghost white for comparison.
const pal = [
  "rgba(110, 138, 111, 1)",    // sage 100
  "rgba(176, 123, 62, 0.95)",  // amber
  "rgba(110, 138, 111, 0.7)",
  "rgba(176, 123, 62, 0.6)",
  "rgba(110, 138, 111, 0.45)",
  "rgba(237, 232, 222, 0.5)",
  "rgba(110, 138, 111, 0.3)",
  "rgba(176, 123, 62, 0.35)",
  "rgba(237, 232, 222, 0.3)",
  "rgba(110, 138, 111, 0.2)",
  "rgba(176, 123, 62, 0.2)",
  "rgba(237, 232, 222, 0.18)",
];
const SAGE = "#6e8a6f";
const AMBER = "#b07b3e";
const grid = { color: "rgba(237, 232, 222, 0.06)", borderDash: [2, 4] as [number, number] };

const shortDate = (v: any) => {
  const s = typeof v === "string" ? v : String(v);
  const m = s.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}` : s;
};

const truncate = (s: any, n = 22) => {
  const str = typeof s === "string" ? s : String(s);
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
};

const tooltipBase = {
  backgroundColor: "#111316",
  borderColor: "rgba(237, 232, 222, 0.12)",
  borderWidth: 1,
  titleColor: "#ede8de",
  titleFont: { family: "var(--font-mono), JetBrains Mono, ui-monospace, monospace", size: 11, weight: 600 as const },
  bodyColor: "rgba(237, 232, 222, 0.85)",
  bodyFont: { family: "var(--font-mono), JetBrains Mono, ui-monospace, monospace", size: 11 },
  padding: 10,
  cornerRadius: 4,
  displayColors: false,
};

const common: any = {
  plugins: {
    legend: { display: false },
    tooltip: { ...tooltipBase, callbacks: { title: (items: any[]) => items.map(i => i.label) } },
  },
  scales: {
    x: {
      grid: { ...grid, drawTicks: false },
      border: { display: false },
      ticks: {
        font: { size: 11 },
        autoSkip: true,
        maxTicksLimit: 8,
        maxRotation: 0,
        minRotation: 0,
        padding: 8,
        callback(this: any, value: any) {
          const label = this.getLabelForValue ? this.getLabelForValue(value) : value;
          return shortDate(label);
        },
      },
    },
    y: {
      grid: { ...grid, drawTicks: false },
      border: { display: false },
      ticks: { font: { size: 11 }, padding: 8 },
    },
  },
  maintainAspectRatio: false,
  responsive: true,
};

const hBarOpts: any = {
  ...common,
  indexAxis: "y" as const,
  scales: {
    x: {
      grid: { ...grid, drawTicks: false },
      border: { display: false },
      ticks: { font: { size: 11 }, padding: 8 },
    },
    y: {
      grid: { display: false },
      border: { display: false },
      ticks: {
        font: { size: 11 },
        autoSkip: false,
        padding: 8,
        callback(this: any, value: any) {
          const label = this.getLabelForValue ? this.getLabelForValue(value) : value;
          return truncate(label);
        },
      },
    },
  },
};

const donutOpts: any = {
  maintainAspectRatio: false,
  responsive: true,
  plugins: {
    legend: {
      display: true,
      position: "right" as const,
      labels: {
        boxWidth: 8,
        boxHeight: 8,
        font: { family: "var(--font-mono), JetBrains Mono, ui-monospace, monospace", size: 11 },
        color: "rgba(237, 232, 222, 0.7)",
        padding: 10,
      },
    },
    tooltip: tooltipBase,
  },
  cutout: "66%",
  borderColor: "#0a0b0d",
  borderWidth: 2,
};

function fmt(n: number) {
  if (!n) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

type Data = any;

export default function OrgDashboard({ data }: { data: { claude: Data; codex: Data } }) {
  const [source, setSource] = useState<"claude" | "codex">("claude");
  const d = data[source];
  const m = d.meta;

  const lineData = (labels: string[], values: number[], color: string) => ({
    labels,
    datasets: [{
      data: values,
      borderColor: color,
      backgroundColor: (ctx: any) => {
        const { chart } = ctx;
        const { ctx: c, chartArea } = chart;
        if (!chartArea) return color + "22";
        const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        g.addColorStop(0, color + "44");
        g.addColorStop(1, color + "00");
        return g;
      },
      fill: true,
      tension: 0.35,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: color,
      pointHoverBorderColor: "#0a0b0d",
      pointHoverBorderWidth: 2,
      borderWidth: 1.5,
    }],
  });
  const barData = (labels: string[], values: number[], colors?: string[]) => ({
    labels,
    datasets: [{ data: values, backgroundColor: colors ?? pal, borderRadius: 2, borderWidth: 0 }],
  });
  const donutData = (labels: string[], values: number[], colors?: string[]) => ({
    labels,
    datasets: [{ data: values, backgroundColor: colors ?? pal, borderColor: "#0a0b0d", borderWidth: 2 }],
  });

  const hasData = d.hours.labels.length > 0;

  return (
    <div>
      <div className="flex gap-1 mb-8 border-b border-border">
        <TabBtn active={source === "claude"} label="Claude Code" count={data.claude.meta.sessions} onClick={() => setSource("claude")} />
        <TabBtn active={source === "codex"} label="Codex" count={data.codex.meta.sessions} onClick={() => setSource("codex")} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 border border-border mb-8">
        <Kpi k="source" v={source} />
        <Kpi k="sessions" v={fmt(m.sessions)} />
        <Kpi k="messages" v={fmt(m.messages)} />
        <Kpi k="output" v={fmt(m.tokensOut)} accent />
        <Kpi k="cache read" v={fmt(m.tokensCacheRead)} />
        <Kpi k="cache hit" v={`${m.cacheHitPct}%`} />
        <Kpi k="repos" v={fmt(m.projects)} />
        {source === "codex" && <Kpi k="reasoning" v={fmt(m.tokensReasoning)} />}
        <Kpi k="waste" v={`${fmt(m.wasteTokens ?? 0)}·${m.wastePct ?? 0}%`} tone="destructive" />
        <Kpi k="teacher" v={fmt(m.teacherMoments ?? 0)} tone="warning" />
        <Kpi k="frustration" v={fmt(m.frustrationSpikes ?? 0)} tone="warning" />
        <Kpi k="prompt len" v={`${m.promptMedianAvg ?? 0}/${m.promptP95Max ?? 0}w`} />
      </div>

      {!hasData ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground text-sm">
          No {source} sessions yet for this org. Run the collector.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <Card title="Active hours per day">
            <div className="h-56"><Line data={lineData(d.hours.labels, d.hours.values, SAGE)} options={common} /></div>
          </Card>

          <Card title="Daily output tokens">
            <div className="h-56"><Line data={lineData(d.daily_tokens.labels, d.daily_tokens.values, AMBER)} options={common} /></div>
          </Card>

          <Card title="Intent mix">
            <div className="h-56"><Doughnut data={donutData(d.intent.labels, d.intent.values)} options={donutOpts} /></div>
          </Card>

          <Card title="Tools used">
            <div className="h-64"><Bar data={barData(d.tools.labels, d.tools.values)} options={hBarOpts} /></div>
          </Card>

          {d.skills.labels.length > 0 && (
            <Card title="Skills used">
              <div className="h-64"><Bar data={barData(d.skills.labels, d.skills.values)} options={hBarOpts} /></div>
            </Card>
          )}

          {d.mcp.labels.length > 0 && (
            <Card title="MCP servers">
              <div className="h-64"><Bar data={barData(d.mcp.labels, d.mcp.values)} options={hBarOpts} /></div>
            </Card>
          )}

          <Card title="Models · output tokens">
            <div className="h-56"><Doughnut data={donutData(d.models.labels, d.models.values)} options={donutOpts} /></div>
          </Card>

          {d.velocity.labels.length > 0 && (
            <Card title="Session velocity">
              <div className="h-56"><Doughnut data={donutData(d.velocity.labels, d.velocity.values)} options={donutOpts} /></div>
            </Card>
          )}

          {d.worktype.labels.length > 0 && (
            <Card title="Work-type mix">
              <div className="h-56"><Doughnut data={donutData(d.worktype.labels, d.worktype.values)} options={donutOpts} /></div>
            </Card>
          )}

          <Card title="Context switches per day">
            <div className="h-56">
              <Bar data={barData(d.ctx.labels, d.ctx.values, d.ctx.values.map((v:number) => v >= 5 ? "#c26a5a" : SAGE))} options={common} />
            </div>
            <div className="text-[11px] text-muted-foreground mt-2">Red ≥ 5 projects/day</div>
          </Card>

          {d.outcome?.labels?.length > 0 && (
            <Card title="Outcome mix · session buckets">
              <div className="h-56">
                <Doughnut
                  data={donutData(
                    d.outcome.labels,
                    d.outcome.values,
                    d.outcome.labels.map((k: string) =>
                      k === "shipped" ? "rgba(110, 138, 111, 1)" :
                      k === "in_review" ? "rgba(110, 138, 111, 0.75)" :
                      k === "in_progress" ? "rgba(110, 138, 111, 0.5)" :
                      k === "planned" ? "rgba(237, 232, 222, 0.35)" :
                      k === "explored" ? "rgba(176, 123, 62, 0.85)" :
                      k === "debugged" ? "rgba(176, 123, 62, 0.55)" :
                      k === "stuck" ? "rgba(176, 123, 62, 1)" :
                      k === "dormant" ? "rgba(194, 106, 90, 0.75)" :
                      k === "zombie" ? "rgba(194, 106, 90, 1)" :
                      "rgba(237, 232, 222, 0.2)"
                    ),
                  )}
                  options={donutOpts}
                />
              </div>
              <div className="mk-label mt-3 normal-case tracking-normal">
                <span className="text-accent">Sage</span> = shipping.{" "}
                <span style={{ color: "var(--warning)" }}>Amber</span> = in flight.{" "}
                <span className="text-destructive">Red</span> = waste.
              </div>
            </Card>
          )}

          {d.thrash?.length > 0 && (
            <Card title="♻️ Thrash files (≥3 sessions unmerged)" className="md:col-span-2 xl:col-span-3">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2">File</th>
                      <th className="text-right py-2 px-2">Sessions</th>
                      <th className="text-right py-2 px-2">Tokens</th>
                      <th className="text-right py-2 px-2">Span (d)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.thrash.map((t: any) => (
                      <tr key={t.file} className="border-b border-border/50">
                        <td className="py-1.5 px-2 font-mono text-muted-foreground truncate max-w-md">{t.file}</td>
                        <td className="py-1.5 px-2 text-right">{t.sessions}</td>
                        <td className="py-1.5 px-2 text-right">{fmt(t.tokens)}</td>
                        <td className="py-1.5 px-2 text-right">{t.days}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card title="Per-project spend" className="md:col-span-2 xl:col-span-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2.5 px-3 mk-label">Repo</th>
                    <th className="text-right py-2.5 px-3 mk-label">Sessions</th>
                    <th className="text-right py-2.5 px-3 mk-label">Msgs</th>
                    <th className="text-right py-2.5 px-3 mk-label">Output tokens</th>
                    <th className="text-right py-2.5 px-3 mk-label">Cache read</th>
                  </tr>
                </thead>
                <tbody>
                  {d.repos.map((r: any) => (
                    <tr key={r.repo} className="border-b border-border/40 hover:bg-[color:var(--secondary)] transition">
                      <td className="py-2 px-3 font-mono text-foreground">{r.repo}</td>
                      <td className="py-2 px-3 text-right mk-numeric">{r.sessions}</td>
                      <td className="py-2 px-3 text-right mk-numeric">{r.msgs}</td>
                      <td className="py-2 px-3 text-right mk-numeric text-accent">{fmt(r.tokensOut)}</td>
                      <td className="py-2 px-3 text-right mk-numeric text-muted-foreground">{fmt(r.tokensCacheRead)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, label, count, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 mk-label transition border-b-2 ${active ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      {label} <span className={`ml-2 mk-numeric text-[10px] ${active ? "text-accent" : "text-muted-foreground"}`}>{count}</span>
    </button>
  );
}

function Kpi({
  k, v, accent, tone,
}: {
  k: string;
  v: React.ReactNode;
  accent?: boolean;
  tone?: "destructive" | "warning";
}) {
  const valueCls = accent
    ? "text-accent"
    : tone === "destructive"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning"
        : "text-foreground";
  return (
    <div className="px-4 py-4 border-r border-b border-border last:border-r-0 [&:nth-child(2n)]:border-r-0 md:[&:nth-child(2n)]:border-r md:[&:nth-child(4n)]:border-r-0 xl:[&:nth-child(4n)]:border-r xl:[&:nth-child(6n)]:border-r-0">
      <div className="mk-label mb-1.5">{k}</div>
      <div className={`mk-numeric text-lg ${valueCls}`}>{v}</div>
    </div>
  );
}

function Card({ title, children, className }: any) {
  return (
    <div className={`mk-card p-5 ${className ?? ""}`}>
      <h3 className="mk-label mb-4">{title}</h3>
      {children}
    </div>
  );
}
