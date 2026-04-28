// Static demo of the per-engineer dashboard at /org/[slug]/dev/[login],
// populated with Jorge Alejandro Diez's data + the holo card from the
// marketing landing. Mirrors the layout in
// apps/web/app/org/[slug]/dev/[login]/page.tsx.

import type { Metadata } from "next";
import {
  Activity, Clock, Database, DatabaseZap, FolderGit2, MessageSquare,
  Plug, Sparkles, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";
import BackButton from "@/components/back-button";
import { CardMount } from "@/app/(marketing)/_card/CardMount";
import { DEMO_CARD } from "@/app/(marketing)/_card/demo-data";

export const metadata: Metadata = {
  title: "Jorge Alejandro Diez · Team snapshot",
  description: "Populated example of the Pellametric per-engineer dashboard.",
};

const NAME = "Jorge Alejandro Diez";
const LOGIN = "alediez2840";
const PHOTO = "/team/jorge.jpeg";
const ORG_NAME = "pella-labs";

const SESSIONS = 7;
const MESSAGES = 824;
const OUTPUT_TOKENS = 2_780_000;
const OUTPUT_COST_LABEL = "$41.7";
const INPUT_TOKENS = 11_830_000;
const INPUT_COST_LABEL = "$2.5K";
const CACHE_HIT_PCT = 87;
const LAST_ACTIVE = "2026-04-19";

const TOP_REPO = {
  name: "pella-labs/pellametric",
  sub: "2.78M tokens",
  rows: [
    { label: "apps/web/lib/aggregate.ts",            value: 412_000 },
    { label: "apps/collector/src/serve.ts",          value: 287_000 },
    { label: "apps/web/components/team-tables.tsx",  value: 198_000 },
    { label: "apps/web/lib/db/schema.ts",            value: 156_000 },
    { label: "apps/web/app/api/ingest/route.ts",     value: 124_000 },
  ],
  unit: "tokens",
};

const TOP_SKILL = {
  name: "superpowers:brainstorming",
  sub: "3 sessions",
  rows: [
    { label: "superpowers:writing-plans",          value: 2 },
    { label: "superpowers:test-driven-development", value: 2 },
    { label: "openclaw-architecture",              value: 1 },
    { label: "openclaw-tdd",                       value: 1 },
    { label: "claude-code-guide",                  value: 1 },
  ],
  unit: "sessions",
};

const TOP_MCP = {
  name: "github",
  sub: "12 sessions",
  rows: [
    { label: "get_pull_request", value: 18 },
    { label: "list_files",       value: 14 },
    { label: "search_code",       value: 9 },
    { label: "get_issue",         value: 6 },
    { label: "create_pr_review",  value: 4 },
  ],
  unit: "calls",
};

const TOP_TOOL = {
  name: "Read",
  sub: "247 calls",
  rows: [
    { label: "Edit",  value: 89 },
    { label: "Bash",  value: 67 },
    { label: "Grep",  value: 54 },
    { label: "Glob",  value: 31 },
    { label: "Write", value: 18 },
  ],
  unit: "calls",
};

const TABS = [
  ["overview", "Overview"],
  ["prs", "PRs"],
  ["skills", "Skills"],
  ["mcp", "MCP"],
  ["tools", "Tools"],
  ["files", "Files"],
  ["sessions", "Sessions"],
] as const;

export default function AlejandroDevPage() {
  return (
    <main className="max-w-[1600px] mx-auto mt-8 px-6 pb-16">
      <header className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-4">
          <BackButton href="/team-snapshot" label="back to team" />
          <img
            src={PHOTO}
            alt={NAME}
            className="size-28 rounded-full border border-border object-cover shrink-0"
            referrerPolicy="no-referrer"
          />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Dev · {ORG_NAME}
            </div>
            <h1 className="text-2xl font-bold mt-1">{NAME}</h1>
            <p className="text-xs text-muted-foreground mt-1 font-mono">{LOGIN}</p>
          </div>
        </div>
        <StaticWindowPicker />
      </header>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <Stat icon={Activity}      label="Sessions"         value={SESSIONS.toLocaleString()} />
        <Stat icon={MessageSquare} label="Messages"         value={MESSAGES.toLocaleString()} />
        <Stat icon={Zap}           label="Output"           value={fmt(OUTPUT_TOKENS)} sub={OUTPUT_COST_LABEL} />
        <Stat icon={Database}      label="Input (billable)" value={fmt(INPUT_TOKENS)}  sub={INPUT_COST_LABEL} />
        <Stat icon={DatabaseZap}   label="Cache hit"        value={`${CACHE_HIT_PCT}%`} />
        <Stat icon={Clock}         label="Last active"      value={LAST_ACTIVE} />
      </div>

      <nav className="flex gap-1 mb-6 border-b border-border overflow-x-auto">
        {TABS.map(([k, label]) => (
          <span
            key={k}
            className={`px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition ${
              k === "overview"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground"
            }`}
          >
            {label}
          </span>
        ))}
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <aside className="bg-card border border-border rounded-lg p-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            Pellametric card
          </div>
          <div className="flex justify-center">
            <CardMount demoData={DEMO_CARD} compact />
          </div>
        </aside>
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          <MiniPanel icon={FolderGit2} title="Top repo"  primary={TOP_REPO.name}  sub={TOP_REPO.sub}  rows={TOP_REPO.rows}  unit={TOP_REPO.unit}  rowsLabel="Files touched" />
          <MiniPanel icon={Sparkles}   title="Top skill" primary={TOP_SKILL.name} sub={TOP_SKILL.sub} rows={TOP_SKILL.rows} unit={TOP_SKILL.unit} rowsLabel="Other skills used" />
          <MiniPanel icon={Plug}       title="Top MCP"   primary={TOP_MCP.name}   sub={TOP_MCP.sub}   rows={TOP_MCP.rows}   unit={TOP_MCP.unit}   rowsLabel="Top tools called" />
          <MiniPanel icon={Wrench}     title="Top tool"  primary={TOP_TOOL.name}  sub={TOP_TOOL.sub}  rows={TOP_TOOL.rows}  unit={TOP_TOOL.unit}  rowsLabel="Other tools" />
        </div>
      </div>
    </main>
  );
}

function fmt(n: number) {
  if (!n) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

function Stat({ icon: Icon, label, value, sub }: { icon: LucideIcon; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex items-start gap-3">
      <div className="p-2 rounded-md shrink-0 bg-primary/15 text-primary">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
        <div className="text-lg font-bold mt-1 text-foreground">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

type Row = { label: string; value: number };

function MiniPanel({
  icon: Icon, title, primary, sub, rows, unit, rowsLabel,
}: {
  icon: LucideIcon; title: string; primary: string; sub: string;
  rows: readonly Row[]; unit: string; rowsLabel: string;
}) {
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 rounded-md bg-primary/15 text-primary shrink-0">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{title}</div>
          <div className="text-base font-semibold text-foreground truncate">{primary}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
        </div>
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">{rowsLabel}</div>
      <ul className="space-y-2">
        {rows.map(r => (
          <li key={r.label} className="text-xs">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="font-mono text-foreground/85 truncate">{r.label}</span>
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                {fmt(r.value)} {unit}
              </span>
            </div>
            <div className="h-1 bg-popover rounded-full overflow-hidden">
              <div
                className="h-full bg-primary/70 rounded-full"
                style={{ width: `${Math.max(4, (100 * r.value) / max)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StaticWindowPicker() {
  const items = [
    { key: "7d", label: "7d" },
    { key: "30d", label: "30d" },
    { key: "90d", label: "90d" },
    { key: "all", label: "All" },
  ] as const;
  const current = "30d";
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-md border border-border bg-card">
      {items.map(w => (
        <span
          key={w.key}
          className={`px-3 py-1 rounded text-[11px] font-mono font-semibold transition ${
            current === w.key ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          {w.label}
        </span>
      ))}
    </div>
  );
}
