"use client";
import { useState } from "react";

function fmt(n: number) {
  if (!n) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

function buildDigest(data: any) {
  const { meta, hours, intent, tools, skills, mcp, models, repos, worktype, velocity } = data;
  if (!meta?.sessions) return { empty: true };

  const totalHours = hours.values.reduce((a: number, b: number) => a + b, 0);
  const biggestDayIdx = hours.values.reduce((maxI: number, v: number, i: number, arr: number[]) => v > arr[maxI] ? i : maxI, 0);
  const biggestDay = hours.labels[biggestDayIdx];
  const biggestHours = hours.values[biggestDayIdx];

  const intentTotal = intent.values.reduce((a: number, b: number) => a + b, 0) || 1;
  const topIntent = intent.labels[0];
  const topIntentPct = Math.round(((intent.values[0] ?? 0) * 100) / intentTotal);

  const topRepo = repos?.[0];
  const topTool = tools.labels[0];
  const topSkill = skills.labels[0];
  const topMcp = mcp.labels[0];

  const parts: string[] = [];
  parts.push(`Across ${meta.sessions} sessions on ${meta.projects} ${meta.projects === 1 ? "repo" : "repos"}, you generated ${fmt(meta.tokensOut)} output tokens (${meta.cacheHitPct}% cache-hit).`);
  if (topRepo) parts.push(`Your heaviest repo was ${topRepo.repo} with ${fmt(topRepo.tokensOut)} output across ${topRepo.sessions} sessions.`);
  if (topIntent) parts.push(`${topIntentPct}% of your prompts looked like "${topIntent}" work.`);
  if (biggestDay) parts.push(`Biggest day: ${biggestDay} with ${biggestHours.toFixed(1)}h active.`);
  if (topTool) parts.push(`Your top tool was ${topTool}${topSkill ? `; top skill ${topSkill}` : ""}${topMcp ? `; top MCP ${topMcp}` : ""}.`);

  return {
    empty: false,
    narrative: parts.join(" "),
    highlights: [
      { k: "Active hours", v: totalHours.toFixed(1) + "h" },
      { k: "Sessions", v: String(meta.sessions) },
      { k: "Messages", v: meta.messages.toLocaleString() },
      { k: "Output", v: fmt(meta.tokensOut) },
      { k: "Cache hit", v: meta.cacheHitPct + "%" },
      { k: "Repos", v: String(meta.projects) },
      { k: "Top repo", v: topRepo?.repo?.split("/")[1] ?? "—" },
      { k: "Top model", v: models.labels[0] ?? "—" },
    ],
    repos: repos ?? [],
    intent, worktype,
  };
}

export default function MyDigest({ data, name }: { data: { claude: any; codex: any }; name: string }) {
  const [source, setSource] = useState<"claude" | "codex">("claude");
  const d = buildDigest(data[source]);

  return (
    <div>
      <div className="flex gap-1 mb-6 border-b border-border">
        <SrcTab active={source === "claude"} label="Claude Code" count={data.claude.meta.sessions} onClick={() => setSource("claude")} />
        <SrcTab active={source === "codex"} label="Codex" count={data.codex.meta.sessions} onClick={() => setSource("codex")} />
      </div>

      {d.empty ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground text-sm">
          No {source} sessions yet for you in this org.
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Your digest — {name}</div>
            <p className="text-base leading-relaxed">{d.narrative}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {d.highlights!.map((h: any) => (
              <div key={h.k} className="bg-card border border-border rounded-lg p-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{h.k}</div>
                <div className="text-lg font-bold mt-1 text-foreground">{h.v}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MiniList title="Top repos" items={(d.repos ?? []).slice(0, 5).map((r: any) => ({ label: r.repo, value: fmt(r.tokensOut) }))} />
            <MiniList title="Intent mix" items={d.intent!.labels.map((l: string, i: number) => ({ label: l, value: String(d.intent!.values[i]) }))} />
            <MiniList title="Work-type" items={d.worktype!.labels.map((l: string, i: number) => ({ label: l, value: fmt(d.worktype!.values[i]) }))} />
          </div>
        </div>
      )}
    </div>
  );
}

function SrcTab({ active, label, count, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      {label}
      <span className={`ml-1.5 text-[10px] px-2 py-0.5 rounded-full ${active ? "bg-primary/20 text-primary" : "bg-card text-muted-foreground"}`}>{count}</span>
    </button>
  );
}

function MiniList({ title, items }: { title: string; items: { label: string; value: string }[] }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">{title}</div>
      <ul className="space-y-1 text-xs">
        {items.length === 0 && <li className="text-muted-foreground">—</li>}
        {items.slice(0, 6).map((it, i) => (
          <li key={i} className="flex justify-between gap-2">
            <span className="truncate">{it.label}</span>
            <span className="text-muted-foreground font-mono">{it.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
