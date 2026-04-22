import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import BackButton from "@/components/back-button";
import WindowPicker from "@/components/window-picker";
import { windowCutoff, parseWindow, type WindowKey } from "@/lib/window";
import { prDetailsForMember } from "@/lib/gh-pr-details";
import { costFor, money } from "@/lib/pricing";

const fmt = (n: number) => {
  if (!n) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
};

type ViewKey = "overview" | "skills" | "mcp" | "prs" | "sessions" | "files" | "tools";

export default async function DevDetailPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string; login: string }>;
  searchParams: Promise<{ view?: string; window?: string }>;
}) {
  const { slug, login } = await params;
  const sp = await searchParams;
  const view = (sp.view as ViewKey) ?? "overview";
  const windowKey: WindowKey = parseWindow(sp.window);
  const cutoff = windowCutoff(windowKey);

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/");

  const [viewer] = await db
    .select({ org: schema.org, role: schema.membership.role })
    .from(schema.membership)
    .innerJoin(schema.org, eq(schema.membership.orgId, schema.org.id))
    .where(and(eq(schema.membership.userId, session.user.id), eq(schema.org.slug, slug)))
    .limit(1);
  if (!viewer) notFound();

  const decoded = decodeURIComponent(login);
  const [target] = await db.select().from(schema.user).where(eq(schema.user.githubLogin, decoded)).limit(1);
  const targetUser = target ?? (await db.select().from(schema.user).where(eq(schema.user.id, decoded)).limit(1))[0];
  if (!targetUser) notFound();

  if (targetUser.id !== session.user.id && viewer.role !== "manager") redirect(`/org/${slug}`);

  const baseFilter = and(eq(schema.sessionEvent.orgId, viewer.org.id), eq(schema.sessionEvent.userId, targetUser.id));
  const sessions = await db.select().from(schema.sessionEvent)
    .where(cutoff ? and(baseFilter, gte(schema.sessionEvent.startedAt, cutoff)) : baseFilter)
    .orderBy(desc(schema.sessionEvent.startedAt));

  // ---------- Aggregate helpers ----------
  const totalOut = sessions.reduce((a, s) => a + Number(s.tokensOut), 0);
  const totalIn = sessions.reduce((a, s) => a + Number(s.tokensIn), 0);
  const totalCR = sessions.reduce((a, s) => a + Number(s.tokensCacheRead), 0);
  const totalMsgs = sessions.reduce((a, s) => a + s.messages, 0);
  const cacheDenom = totalCR + totalIn;
  const cacheHitPct = cacheDenom ? +((100 * totalCR) / cacheDenom).toFixed(1) : 0;
  const costIn = sessions.reduce((a, s) => a + costFor(s.model, {
    tokensIn: Number(s.tokensIn), tokensOut: 0,
    tokensCacheRead: Number(s.tokensCacheRead), tokensCacheWrite: Number(s.tokensCacheWrite),
  }), 0);
  const costOut = sessions.reduce((a, s) => a + costFor(s.model, {
    tokensIn: 0, tokensOut: Number(s.tokensOut), tokensCacheRead: 0, tokensCacheWrite: 0,
  }), 0);

  return (
    <main className="max-w-[1600px] mx-auto mt-8 px-6 pb-16">
      <header className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-4">
          <BackButton href={`/org/${slug}`} label="back to team" />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Dev · {viewer.org.name}</div>
            <h1 className="text-2xl font-bold mt-1">{targetUser.name}</h1>
            <p className="text-xs text-muted-foreground mt-1 font-mono">{targetUser.githubLogin ?? targetUser.id}</p>
          </div>
        </div>
        <WindowPicker current={windowKey} />
      </header>

      {/* Header KPIs always visible */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <Stat label="Sessions" value={sessions.length.toString()} />
        <Stat label="Messages" value={totalMsgs.toLocaleString()} />
        <Stat label="Output" value={fmt(totalOut)} sub={money(costOut)} />
        <Stat label="Input (billable)" value={fmt(totalIn)} sub={money(costIn)} />
        <Stat label="Cache hit" value={`${cacheHitPct}%`} />
        <Stat label="Last active" value={sessions[0]?.startedAt ? new Date(sessions[0].startedAt).toISOString().slice(0, 10) : "—"} />
      </div>

      {/* Focus tabs */}
      <nav className="flex gap-1 mb-6 border-b border-border overflow-x-auto">
        {[
          ["overview", "Overview"],
          ["prs", "PRs"],
          ["skills", "Skills"],
          ["mcp", "MCP"],
          ["tools", "Tools"],
          ["files", "Files"],
          ["sessions", "Sessions"],
        ].map(([k, label]) => (
          <Link
            key={k}
            href={`?view=${k}`}
            className={`px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition ${view === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {view === "overview" && <OverviewView sessions={sessions} />}
      {view === "skills" && <SkillsView sessions={sessions} />}
      {view === "mcp" && <McpView sessions={sessions} />}
      {view === "tools" && <ToolsView sessions={sessions} />}
      {view === "files" && <FilesView sessions={sessions} />}
      {view === "sessions" && <SessionsView sessions={sessions} />}
      {view === "prs" && <PrsView orgSlug={slug} login={targetUser.githubLogin} viewerId={session.user.id} sessions={sessions} />}
    </main>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "positive" | "destructive" }) {
  const valueClass = tone === "positive" ? "text-positive" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-lg font-bold mt-1 ${valueClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

/* ------------------------- Views ------------------------- */

function OverviewView({ sessions }: { sessions: any[] }) {
  // Show a compact 4-card summary of: top skill, top MCP, top tool, top repo
  const skills = new Map<string, number>();
  const mcps = new Map<string, number>();
  const tools = new Map<string, number>();
  const repos = new Map<string, number>();
  for (const s of sessions) {
    for (const sk of (s.skillsUsed ?? [])) skills.set(sk, (skills.get(sk) ?? 0) + 1);
    for (const mc of (s.mcpsUsed ?? [])) mcps.set(mc, (mcps.get(mc) ?? 0) + 1);
    for (const [t, n] of Object.entries(s.toolHist ?? {})) tools.set(t, (tools.get(t) ?? 0) + (n as number));
    repos.set(s.repo, (repos.get(s.repo) ?? 0) + Number(s.tokensOut));
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <MiniPanel title="Top repo" primary={top(repos)?.[0] ?? "—"} sub={top(repos) ? `${fmt(top(repos)![1])} tokens` : ""} />
      <MiniPanel title="Top skill" primary={top(skills)?.[0] ?? "—"} sub={top(skills) ? `${top(skills)![1]} sessions` : ""} />
      <MiniPanel title="Top MCP" primary={top(mcps)?.[0] ?? "—"} sub={top(mcps) ? `${top(mcps)![1]} sessions` : ""} />
      <MiniPanel title="Top tool" primary={top(tools)?.[0] ?? "—"} sub={top(tools) ? `${top(tools)![1]} calls` : ""} />
    </div>
  );
}

function MiniPanel({ title, primary, sub }: { title: string; primary: string; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{title}</div>
      <div className="text-base font-semibold text-foreground truncate">{primary}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

function SkillsView({ sessions }: { sessions: any[] }) {
  const rows = new Map<string, { calls: number; sessions: number; tokens: number }>();
  for (const s of sessions) {
    const skills: string[] = Array.isArray(s.skillsUsed) ? s.skillsUsed : [];
    if (skills.length === 0) continue;
    for (const sk of skills) {
      const v = rows.get(sk) ?? { calls: 0, sessions: 0, tokens: 0 };
      v.sessions++;
      v.tokens += Number(s.tokensOut) / skills.length;
      rows.set(sk, v);
    }
  }
  const list = [...rows.entries()].sort((a, b) => b[1].tokens - a[1].tokens);
  const max = list[0]?.[1]?.tokens ?? 1;
  return (
    <SimpleTable
      title="Skills — how they got used"
      empty="No skills recorded."
      cols={[
        { label: "Skill", align: "left" },
        { label: "Sessions", align: "right" },
        { label: "Tokens", align: "right" },
        { label: "", align: "left" },
      ]}
    >
      {list.map(([name, v]) => (
        <tr key={name} className="border-b border-border/50">
          <td className="py-2 px-3 font-mono">{name}</td>
          <td className="py-2 px-3 text-right">{v.sessions}</td>
          <td className="py-2 px-3 text-right">{fmt(Math.round(v.tokens))}</td>
          <td className="py-2 px-3 w-1/3">
            <div className="h-1.5 bg-popover rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${Math.max(4, (100 * v.tokens) / max)}%` }} /></div>
          </td>
        </tr>
      ))}
    </SimpleTable>
  );
}

function McpView({ sessions }: { sessions: any[] }) {
  const rows = new Map<string, { sessions: number; tokens: number }>();
  for (const s of sessions) {
    const mcps: string[] = Array.isArray(s.mcpsUsed) ? s.mcpsUsed : [];
    if (mcps.length === 0) continue;
    for (const mc of mcps) {
      const v = rows.get(mc) ?? { sessions: 0, tokens: 0 };
      v.sessions++;
      v.tokens += Number(s.tokensOut) / mcps.length;
      rows.set(mc, v);
    }
  }
  const list = [...rows.entries()].sort((a, b) => b[1].tokens - a[1].tokens);
  const max = list[0]?.[1]?.tokens ?? 1;
  return (
    <SimpleTable
      title="MCP servers — adoption + spend"
      empty="No MCP calls recorded."
      cols={[
        { label: "Server", align: "left" },
        { label: "Sessions", align: "right" },
        { label: "Tokens", align: "right" },
        { label: "", align: "left" },
      ]}
    >
      {list.map(([name, v]) => (
        <tr key={name} className="border-b border-border/50">
          <td className="py-2 px-3 font-mono">{name}</td>
          <td className="py-2 px-3 text-right">{v.sessions}</td>
          <td className="py-2 px-3 text-right">{fmt(Math.round(v.tokens))}</td>
          <td className="py-2 px-3 w-1/3">
            <div className="h-1.5 bg-popover rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${Math.max(4, (100 * v.tokens) / max)}%` }} /></div>
          </td>
        </tr>
      ))}
    </SimpleTable>
  );
}

function ToolsView({ sessions }: { sessions: any[] }) {
  const rows = new Map<string, number>();
  for (const s of sessions) {
    for (const [t, n] of Object.entries(s.toolHist ?? {})) rows.set(t, (rows.get(t) ?? 0) + (n as number));
  }
  const list = [...rows.entries()].sort((a, b) => b[1] - a[1]);
  const max = list[0]?.[1] ?? 1;
  return (
    <SimpleTable
      title="Tools — call counts"
      empty="No tool calls recorded."
      cols={[
        { label: "Tool", align: "left" },
        { label: "Calls", align: "right" },
        { label: "", align: "left" },
      ]}
    >
      {list.map(([name, n]) => (
        <tr key={name} className="border-b border-border/50">
          <td className="py-2 px-3 font-mono">{name}</td>
          <td className="py-2 px-3 text-right">{n.toLocaleString()}</td>
          <td className="py-2 px-3 w-1/2">
            <div className="h-1.5 bg-popover rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${Math.max(4, (100 * n) / max)}%` }} /></div>
          </td>
        </tr>
      ))}
    </SimpleTable>
  );
}

function FilesView({ sessions }: { sessions: any[] }) {
  const rows = new Map<string, { tokens: number; sessions: number }>();
  for (const s of sessions) {
    const files: string[] = Array.isArray(s.filesEdited) ? s.filesEdited : [];
    if (!files.length) continue;
    const each = Number(s.tokensOut) / files.length;
    for (const f of files) {
      const v = rows.get(f) ?? { tokens: 0, sessions: 0 };
      v.tokens += each; v.sessions++;
      rows.set(f, v);
    }
  }
  const list = [...rows.entries()].sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 50);
  const thrash = list.filter(([_, v]) => v.sessions >= 3);
  return (
    <div className="space-y-6">
      <SimpleTable title={`Thrash files — touched ≥3 sessions (${thrash.length})`} empty="No thrash detected." cols={[{ label: "File", align: "left" }, { label: "Sessions", align: "right" }, { label: "Tokens", align: "right" }]}>
        {thrash.map(([f, v]) => (
          <tr key={f} className="border-b border-border/50">
            <td className="py-2 px-3 font-mono truncate max-w-xl text-muted-foreground">{f}</td>
            <td className="py-2 px-3 text-right text-warning">{v.sessions}</td>
            <td className="py-2 px-3 text-right">{fmt(Math.round(v.tokens))}</td>
          </tr>
        ))}
      </SimpleTable>
      <SimpleTable title="Top files (by attributed tokens)" empty="No files touched." cols={[{ label: "File", align: "left" }, { label: "Sessions", align: "right" }, { label: "Tokens", align: "right" }]}>
        {list.map(([f, v]) => (
          <tr key={f} className="border-b border-border/50">
            <td className="py-2 px-3 font-mono truncate max-w-xl text-muted-foreground">{f}</td>
            <td className="py-2 px-3 text-right">{v.sessions}</td>
            <td className="py-2 px-3 text-right">{fmt(Math.round(v.tokens))}</td>
          </tr>
        ))}
      </SimpleTable>
    </div>
  );
}

function SessionsView({ sessions }: { sessions: any[] }) {
  return (
    <SimpleTable
      title={`Sessions (${sessions.length})`}
      empty="No sessions."
      cols={[
        { label: "Started", align: "left" },
        { label: "Source", align: "left" },
        { label: "Repo", align: "left" },
        { label: "Intent", align: "left" },
        { label: "Msgs", align: "right" },
        { label: "Tokens", align: "right" },
        { label: "Files", align: "right" },
        { label: "Err", align: "right" },
        { label: "Teacher", align: "right" },
      ]}
    >
      {sessions.slice(0, 200).map(s => (
        <tr key={s.id} className="border-b border-border/50 hover:bg-popover/40">
          <td className="py-1.5 px-3 font-mono text-muted-foreground">
            {new Date(s.startedAt).toISOString().slice(0, 16).replace("T", " ")}
          </td>
          <td className="py-1.5 px-3"><span className="text-[10px] px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">{s.source}</span></td>
          <td className="py-1.5 px-3 font-mono text-muted-foreground">{s.repo}</td>
          <td className="py-1.5 px-3">{s.intentTop ?? "—"}</td>
          <td className="py-1.5 px-3 text-right">{s.messages}</td>
          <td className="py-1.5 px-3 text-right">{fmt(Number(s.tokensOut))}</td>
          <td className="py-1.5 px-3 text-right">{Array.isArray(s.filesEdited) ? s.filesEdited.length : 0}</td>
          <td className={`py-1.5 px-3 text-right ${s.errors > 0 ? "text-warning" : ""}`}>{s.errors}</td>
          <td className={`py-1.5 px-3 text-right ${s.teacherMoments > 0 ? "text-warning" : ""}`}>{s.teacherMoments ?? 0}</td>
        </tr>
      ))}
    </SimpleTable>
  );
}

async function PrsView({ orgSlug, login, viewerId, sessions }: { orgSlug: string; login: string | null; viewerId: string; sessions: any[] }) {
  if (!login) return <Empty msg="No GitHub login on account." />;
  const [acc] = await db.select().from(schema.account)
    .where(and(eq(schema.account.userId, viewerId), eq(schema.account.providerId, "github")))
    .limit(1);
  if (!acc?.accessToken) return <Empty msg="No GitHub token on file." />;
  const prs = await prDetailsForMember(orgSlug, login, acc.accessToken);
  if (prs.length === 0) return <Empty msg="No PRs found." />;

  // Token attribution: file-overlap + time-window match.
  const prTokens = new Map<string, { input: number; output: number; sessions: number }>();
  for (const pr of prs) {
    const winStart = new Date(new Date(pr.createdAt).getTime() - 30 * 60_000);         // -30 min
    const winEnd = pr.mergedAt ? new Date(new Date(pr.mergedAt).getTime() + 60 * 60_000) : new Date();  // merged +1h, or now
    const prFiles = new Set(pr.files);
    let input = 0, output = 0, n = 0;
    for (const s of sessions) {
      if (s.repo !== pr.repo) continue;
      if (s.startedAt > winEnd || s.endedAt < winStart) continue;
      const files: string[] = Array.isArray(s.filesEdited) ? s.filesEdited : [];
      const overlap = files.some(f => {
        // session files are absolute paths; match suffix against pr repo-relative paths
        for (const pf of prFiles) if (f.endsWith("/" + pf) || f === pf) return true;
        return false;
      });
      if (!overlap) continue;
      input += Number(s.tokensIn) + Number(s.tokensCacheRead) + Number(s.tokensCacheWrite);
      output += Number(s.tokensOut);
      n++;
    }
    prTokens.set(`${pr.repo}#${pr.number}`, { input, output, sessions: n });
  }

  const merged = prs.filter(p => p.merged);
  const open = prs.filter(p => p.state === "open");
  const totalAdd = prs.reduce((a, p) => a + p.additions, 0);
  const totalDel = prs.reduce((a, p) => a + p.deletions, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="PRs total" value={prs.length.toString()} />
        <Stat label="Merged" value={merged.length.toString()} />
        <Stat label="Open" value={open.length.toString()} />
        <Stat label="+LOC" value={`+${totalAdd.toLocaleString()}`} tone="positive" />
        <Stat label="−LOC" value={`−${totalDel.toLocaleString()}`} tone="destructive" />
      </div>

      <SimpleTable
        title={`Per-PR detail`}
        empty="—"
        cols={[
          { label: "PR", align: "left" },
          { label: "Title", align: "left" },
          { label: "Input tok", align: "right" },
          { label: "Output tok", align: "right" },
          { label: "+LOC", align: "right" },
          { label: "−LOC", align: "right" },
          { label: "Files", align: "right" },
          { label: "Commits", align: "right" },
          { label: "Reviews", align: "right" },
          { label: "State", align: "left" },
          { label: "Merge (h)", align: "right" },
        ]}
      >
        {prs.sort((a, b) => b.additions - a.additions).map(p => {
          const mergeHrs = p.merged && p.mergedAt ? (new Date(p.mergedAt).getTime() - new Date(p.createdAt).getTime()) / 3600000 : null;
          const tok = prTokens.get(`${p.repo}#${p.number}`) ?? { input: 0, output: 0, sessions: 0 };
          return (
            <tr key={`${p.repo}#${p.number}`} className="border-b border-border/50">
              <td className="py-1.5 px-3 whitespace-nowrap"><a href={p.url} target="_blank" className="text-primary hover:underline font-mono">{p.repo.split("/")[1]}#{p.number}</a></td>
              <td className="py-1.5 px-3 text-muted-foreground max-w-[22rem]">
                <div title={p.title} className="truncate">{p.title}</div>
              </td>
              <td className="py-1.5 px-3 text-right font-mono text-[11px]" title={`${tok.input.toLocaleString()} input tokens across ${tok.sessions} session${tok.sessions === 1 ? "" : "s"}`}>{tok.input > 0 ? fmt(tok.input) : "—"}</td>
              <td className="py-1.5 px-3 text-right font-mono text-[11px]" title={`${tok.output.toLocaleString()} output tokens across ${tok.sessions} session${tok.sessions === 1 ? "" : "s"}`}>{tok.output > 0 ? fmt(tok.output) : "—"}</td>
              <td className="py-1.5 px-3 text-right text-positive">+{p.additions.toLocaleString()}</td>
              <td className="py-1.5 px-3 text-right text-destructive">−{p.deletions.toLocaleString()}</td>
              <td className="py-1.5 px-3 text-right">{p.changedFiles}</td>
              <td className="py-1.5 px-3 text-right">{p.commits}</td>
              <td className="py-1.5 px-3 text-right">{p.reviewComments}</td>
              <td className="py-1.5 px-3">{p.merged ? <span className="text-positive">merged</span> : p.state === "open" ? <span className="text-warning">open</span> : <span className="text-muted-foreground">closed</span>}</td>
              <td className="py-1.5 px-3 text-right font-mono text-[11px]">{mergeHrs != null ? `${mergeHrs.toFixed(1)}h` : "—"}</td>
            </tr>
          );
        })}
      </SimpleTable>
    </div>
  );
}

/* ---------- helpers ---------- */

type Col = string | { label: string; align?: "left" | "right" };

function SimpleTable({ title, empty, cols, children }: { title: string; empty: string; cols: Col[]; children: React.ReactNode }) {
  const childArr = Array.isArray(children) ? children : [children];
  const isEmpty = childArr.filter(Boolean).length === 0;
  return (
    <section>
      <h2 className="text-sm uppercase tracking-wider text-muted-foreground font-semibold mb-3">{title}</h2>
      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              {cols.map((c, i) => {
                const label = typeof c === "string" ? c : c.label;
                const align = typeof c === "string" ? (i === 0 ? "left" : "right") : (c.align ?? "left");
                return <th key={label + i} className={`py-2 px-3 ${align === "right" ? "text-right" : "text-left"}`}>{label}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {isEmpty ? <tr><td colSpan={cols.length} className="py-6 text-center text-muted-foreground">{empty}</td></tr> : children}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">{msg}</div>;
}
