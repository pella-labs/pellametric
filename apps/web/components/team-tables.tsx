"use client";
import Link from "next/link";
import { money } from "@/lib/pricing";

function fmt(n: number) {
  if (!n) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

export type TeamRow = {
  userId: string;
  name: string;
  login: string | null;
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
  return (
    <Link href={devHref(r)} className="block hover:text-primary transition">
      <div className="font-medium">{r.name}</div>
      <div className="text-[10px] text-muted-foreground font-mono">{r.login ?? "—"}</div>
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

function DeliveryTable({ rows }: { rows: TeamRow[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-muted-foreground">
        <tr className="border-b border-border">
          <th className="text-left py-2 px-3">Dev</th>
          <th className="text-right py-2 px-3">PRs total</th>
          <th className="text-right py-2 px-3">Open</th>
          <th className="text-right py-2 px-3">Merged</th>
          <th className="text-right py-2 px-3">Closed</th>
          <th className="text-right py-2 px-3">Input (cost)</th>
          <th className="text-right py-2 px-3">Output (cost)</th>
          <th className="text-right py-2 px-3">+LOC</th>
          <th className="text-right py-2 px-3">−LOC</th>
          <th className="text-right py-2 px-3">Sessions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
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

function SkillsOnlyTable({ rows }: { rows: TeamRow[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-muted-foreground">
        <tr className="border-b border-border">
          <th className="text-left py-2 px-3">Dev</th>
          <th className="text-right py-2 px-3">Skill sessions</th>
          <th className="text-right py-2 px-3">Skill tokens</th>
          <th className="text-right py-2 px-3">% of output</th>
          <th className="text-right py-2 px-3">Total output</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
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

function McpOnlyTable({ rows }: { rows: TeamRow[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="text-muted-foreground">
        <tr className="border-b border-border">
          <th className="text-left py-2 px-3">Dev</th>
          <th className="text-right py-2 px-3">MCP sessions</th>
          <th className="text-right py-2 px-3">MCP tokens</th>
          <th className="text-right py-2 px-3">% of output</th>
          <th className="text-right py-2 px-3">Total output</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
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
