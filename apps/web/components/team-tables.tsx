"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { money } from "@/lib/pricing";

function fmt(n: number) {
  if (!n) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

type SortDir = "asc" | "desc";
type SortState<K extends string> = { key: K; dir: SortDir };

function toggleSort<K extends string>(cur: SortState<K> | null, key: K): SortState<K> {
  if (!cur || cur.key !== key) return { key, dir: "desc" };
  return { key, dir: cur.dir === "desc" ? "asc" : "desc" };
}

function sortRows<T, K extends string>(rows: T[], sort: SortState<K> | null, get: (r: T, k: K) => string | number | null | undefined): T[] {
  if (!sort) return rows;
  const mult = sort.dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = get(a, sort.key);
    const bv = get(b, sort.key);
    // nulls always last regardless of dir
    const an = av == null, bn = bv == null;
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * mult;
    return String(av).localeCompare(String(bv)) * mult;
  });
}

function SortTh({
  label, active, align = "right", onClick,
}: { label: string; active: SortDir | null; align?: "left" | "right"; onClick: () => void }) {
  const arrow = active === "desc" ? "↓" : active === "asc" ? "↑" : "";
  return (
    <th className={`text-${align} py-2 px-3`}>
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-foreground transition ${active ? "text-foreground" : ""}`}
      >
        <span>{label}</span>
        <span className="text-[10px] text-accent w-2.5 inline-block">{arrow}</span>
      </button>
    </th>
  );
}

export type TeamRow = {
  userId: string;
  name: string;
  login: string | null;
  image: string | null;
  orgSlug: string;
  sessions: number;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  costIn: number;
  costOut: number;
  skillTokens: number;
  skillSessions: number;
  mcpTokens: number;
  mcpSessions: number;
  // New richer fields
  cacheHitPct: number;
  activeHours: number;
  lastActive: string | null;     // ISO
  wasteTokens: number;
  wastePct: number;
  teacherMoments: number;
  frustrationSpikes: number;
  errors: number;
  // PR aggregates
  prOpened?: number;
  prMerged?: number;
  prClosed?: number;
  prOpenNow?: number;
  additions?: number;
  deletions?: number;
};

export default function TeamTables({ rows }: { rows: TeamRow[] }) {
  return (
    <section className="mt-8 space-y-6">
      <div>
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground font-semibold mb-3">Delivery + spend</h2>
        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          <DeliveryTable rows={rows} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div>
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground font-semibold mb-3">Skills</h2>
          <div className="bg-card border border-border rounded-lg overflow-x-auto">
            <SkillsOnlyTable rows={rows} />
          </div>
        </div>
        <div>
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground font-semibold mb-3">MCP</h2>
          <div className="bg-card border border-border rounded-lg overflow-x-auto">
            <McpOnlyTable rows={rows} />
          </div>
        </div>
      </div>
    </section>
  );
}

function devHref(r: TeamRow, view?: string) {
  const base = `/org/${r.orgSlug}/dev/${encodeURIComponent(r.login ?? r.userId)}`;
  return view ? `${base}?view=${view}` : base;
}

function DevCell({ r }: { r: TeamRow }) {
  const initial = (r.name?.[0] ?? r.login?.[0] ?? "?").toUpperCase();
  return (
    <Link href={devHref(r)} className="flex items-center gap-2.5 hover:text-primary transition">
      {r.image ? (
        <img
          src={r.image}
          alt={r.name}
          className="size-7 rounded-full border border-border object-cover shrink-0"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="size-7 rounded-full border border-border bg-popover flex items-center justify-center text-[10px] text-muted-foreground font-semibold shrink-0">
          {initial}
        </div>
      )}
      <div className="min-w-0">
        <div className="font-medium truncate">{r.name}</div>
        <div className="text-[10px] text-muted-foreground font-mono truncate">{r.login ?? "—"}</div>
      </div>
    </Link>
  );
}

function LinkCell({ r, view, children, className = "" }: { r: TeamRow; view: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={devHref(r, view)} className={`block hover:text-primary transition ${className}`}>
      {children}
    </Link>
  );
}

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

type DeliveryKey = "name" | "prOpened" | "prOpenNow" | "prMerged" | "prClosed" | "tokensIn" | "tokensOut" | "additions" | "deletions" | "sessions";

function DeliveryTable({ rows }: { rows: TeamRow[] }) {
  const [sort, setSort] = useState<SortState<DeliveryKey> | null>(null);
  const sorted = useMemo(() => sortRows<TeamRow, DeliveryKey>(rows, sort, (r, k) => {
    if (k === "name") return r.name.toLowerCase();
    return r[k as Exclude<DeliveryKey, "name">] ?? null;
  }), [rows, sort]);
  const active = (k: DeliveryKey) => sort?.key === k ? sort.dir : null;
  const click = (k: DeliveryKey) => () => setSort(prev => toggleSort(prev, k));
  return (
    <table className="w-full text-xs">
      <thead className="text-muted-foreground">
        <tr className="border-b border-border">
          <SortTh label="Dev"          align="left"  active={active("name")}       onClick={click("name")} />
          <SortTh label="PRs total"    active={active("prOpened")}   onClick={click("prOpened")} />
          <SortTh label="Open"         active={active("prOpenNow")}  onClick={click("prOpenNow")} />
          <SortTh label="Merged"       active={active("prMerged")}   onClick={click("prMerged")} />
          <SortTh label="Closed"       active={active("prClosed")}   onClick={click("prClosed")} />
          <SortTh label="Input (cost)" active={active("tokensIn")}   onClick={click("tokensIn")} />
          <SortTh label="Output (cost)" active={active("tokensOut")} onClick={click("tokensOut")} />
          <SortTh label="+LOC"         active={active("additions")}  onClick={click("additions")} />
          <SortTh label="−LOC"         active={active("deletions")}  onClick={click("deletions")} />
          <SortTh label="Sessions"     active={active("sessions")}   onClick={click("sessions")} />
        </tr>
      </thead>
      <tbody>
        {sorted.map(r => (
          <tr key={r.userId} className="border-b border-border/50 hover:bg-popover/40">
            <td className="py-2 px-3"><DevCell r={r} /></td>
            <td className="py-2 px-3 text-right"><LinkCell r={r} view="prs">{r.prOpened ?? "—"}</LinkCell></td>
            <td className="py-2 px-3 text-right text-warning"><LinkCell r={r} view="prs">{r.prOpenNow ?? "—"}</LinkCell></td>
            <td className="py-2 px-3 text-right text-positive"><LinkCell r={r} view="prs">{r.prMerged ?? "—"}</LinkCell></td>
            <td className="py-2 px-3 text-right text-muted-foreground"><LinkCell r={r} view="prs">{r.prClosed ?? "—"}</LinkCell></td>
            <td className="py-2 px-3 text-right">
              <div>{fmt(r.tokensIn)}</div>
              <div className="text-[10px] text-muted-foreground">{money(r.costIn)}</div>
            </td>
            <td className="py-2 px-3 text-right">
              <div>{fmt(r.tokensOut)}</div>
              <div className="text-[10px] text-muted-foreground">{money(r.costOut)}</div>
            </td>
            <td className="py-2 px-3 text-right text-positive"><LinkCell r={r} view="prs">{r.additions != null ? `+${r.additions.toLocaleString()}` : "—"}</LinkCell></td>
            <td className="py-2 px-3 text-right text-destructive"><LinkCell r={r} view="prs">{r.deletions != null ? `−${r.deletions.toLocaleString()}` : "—"}</LinkCell></td>
            <td className="py-2 px-3 text-right"><LinkCell r={r} view="sessions">{r.sessions}</LinkCell></td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-muted-foreground">No members yet.</td></tr>}
      </tbody>
    </table>
  );
}

type SkillKey = "name" | "skillSessions" | "skillTokens" | "skillPct" | "tokensOut";

function SkillsOnlyTable({ rows }: { rows: TeamRow[] }) {
  const [sort, setSort] = useState<SortState<SkillKey> | null>(null);
  const sorted = useMemo(() => sortRows<TeamRow, SkillKey>(rows, sort, (r, k) => {
    if (k === "name") return r.name.toLowerCase();
    if (k === "skillPct") return r.tokensOut > 0 ? (100 * r.skillTokens) / r.tokensOut : 0;
    return r[k as "skillSessions" | "skillTokens" | "tokensOut"];
  }), [rows, sort]);
  const active = (k: SkillKey) => sort?.key === k ? sort.dir : null;
  const click = (k: SkillKey) => () => setSort(prev => toggleSort(prev, k));
  return (
    <table className="w-full text-xs">
      <thead className="text-muted-foreground">
        <tr className="border-b border-border">
          <SortTh label="Dev"            align="left" active={active("name")}          onClick={click("name")} />
          <SortTh label="Skill sessions"              active={active("skillSessions")} onClick={click("skillSessions")} />
          <SortTh label="Skill tokens"                active={active("skillTokens")}   onClick={click("skillTokens")} />
          <SortTh label="% of output"                 active={active("skillPct")}      onClick={click("skillPct")} />
          <SortTh label="Total output"                active={active("tokensOut")}     onClick={click("tokensOut")} />
        </tr>
      </thead>
      <tbody>
        {sorted.map(r => (
          <tr key={r.userId} className="border-b border-border/50 hover:bg-popover/40">
            <td className="py-2 px-3"><DevCell r={r} /></td>
            <td className="py-2 px-3 text-right"><LinkCell r={r} view="skills">{r.skillSessions}</LinkCell></td>
            <td className="py-2 px-3 text-right"><LinkCell r={r} view="skills">{fmt(r.skillTokens)}</LinkCell></td>
            <td className="py-2 px-3 text-right text-muted-foreground">{r.tokensOut > 0 ? ((100 * r.skillTokens) / r.tokensOut).toFixed(0) + "%" : "—"}</td>
            <td className="py-2 px-3 text-right text-muted-foreground">{fmt(r.tokensOut)}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No members yet.</td></tr>}
      </tbody>
    </table>
  );
}

type McpKey = "name" | "mcpSessions" | "mcpTokens" | "mcpPct" | "tokensOut";

function McpOnlyTable({ rows }: { rows: TeamRow[] }) {
  const [sort, setSort] = useState<SortState<McpKey> | null>(null);
  const sorted = useMemo(() => sortRows<TeamRow, McpKey>(rows, sort, (r, k) => {
    if (k === "name") return r.name.toLowerCase();
    if (k === "mcpPct") return r.tokensOut > 0 ? (100 * r.mcpTokens) / r.tokensOut : 0;
    return r[k as "mcpSessions" | "mcpTokens" | "tokensOut"];
  }), [rows, sort]);
  const active = (k: McpKey) => sort?.key === k ? sort.dir : null;
  const click = (k: McpKey) => () => setSort(prev => toggleSort(prev, k));
  return (
    <table className="w-full text-xs">
      <thead className="text-muted-foreground">
        <tr className="border-b border-border">
          <SortTh label="Dev"          align="left" active={active("name")}         onClick={click("name")} />
          <SortTh label="MCP sessions"              active={active("mcpSessions")}  onClick={click("mcpSessions")} />
          <SortTh label="MCP tokens"                active={active("mcpTokens")}    onClick={click("mcpTokens")} />
          <SortTh label="% of output"               active={active("mcpPct")}       onClick={click("mcpPct")} />
          <SortTh label="Total output"              active={active("tokensOut")}    onClick={click("tokensOut")} />
        </tr>
      </thead>
      <tbody>
        {sorted.map(r => (
          <tr key={r.userId} className="border-b border-border/50 hover:bg-popover/40">
            <td className="py-2 px-3"><DevCell r={r} /></td>
            <td className="py-2 px-3 text-right"><LinkCell r={r} view="mcp">{r.mcpSessions}</LinkCell></td>
            <td className="py-2 px-3 text-right"><LinkCell r={r} view="mcp">{fmt(r.mcpTokens)}</LinkCell></td>
            <td className="py-2 px-3 text-right text-muted-foreground">{r.tokensOut > 0 ? ((100 * r.mcpTokens) / r.tokensOut).toFixed(0) + "%" : "—"}</td>
            <td className="py-2 px-3 text-right text-muted-foreground">{fmt(r.tokensOut)}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No members yet.</td></tr>}
      </tbody>
    </table>
  );
}

function TabBtn({ active, label, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      {label}
    </button>
  );
}
