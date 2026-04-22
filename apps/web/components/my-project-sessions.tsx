"use client";

import { useMemo, useState } from "react";
import SessionsList from "./sessions-list";

function fmt(n: number) {
  if (!n) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

type Sess = {
  id: string;
  source: "claude" | "codex";
  externalSessionId: string;
  repo: string;
  startedAt: string;
  intentTop?: string | null;
  messages: number;
  tokensOut: number;
  filesEdited: string[];
  errors: number;
  teacherMoments?: number;
  userTurns?: number;
};

export default function MyProjectSessions({ sessions }: { sessions: Sess[] }) {
  const [source, setSource] = useState<"claude" | "codex">("claude");
  const filteredBySource = useMemo(() => sessions.filter(s => s.source === source), [sessions, source]);

  // Project (repo) list scoped to source
  const repos = useMemo(() => {
    const m = new Map<string, { sessions: number; tokensOut: number; lastActive: string }>();
    for (const s of filteredBySource) {
      const v = m.get(s.repo) ?? { sessions: 0, tokensOut: 0, lastActive: s.startedAt };
      v.sessions++;
      v.tokensOut += Number(s.tokensOut);
      if (s.startedAt > v.lastActive) v.lastActive = s.startedAt;
      m.set(s.repo, v);
    }
    return [...m.entries()].sort((a, b) => b[1].tokensOut - a[1].tokensOut);
  }, [filteredBySource]);

  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const activeRepo = selectedRepo && repos.find(([r]) => r === selectedRepo) ? selectedRepo : (repos[0]?.[0] ?? null);

  const rows = useMemo(
    () => activeRepo ? filteredBySource.filter(s => s.repo === activeRepo) : [],
    [filteredBySource, activeRepo],
  );

  const claudeCount = sessions.filter(s => s.source === "claude").length;
  const codexCount = sessions.filter(s => s.source === "codex").length;

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="mk-heading text-xl">Your sessions — by project</h2>
        <div className="mk-label text-muted-foreground normal-case tracking-normal">click a session to read the prompts</div>
      </div>

      {/* Source tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        <SourceTab active={source === "claude"} label="Claude Code" count={claudeCount} onClick={() => { setSource("claude"); setSelectedRepo(null); }} />
        <SourceTab active={source === "codex"}  label="Codex"       count={codexCount}  onClick={() => { setSource("codex");  setSelectedRepo(null); }} />
      </div>

      {repos.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground text-sm">
          No {source} sessions yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[320px,1fr] gap-4">
          {/* Project list */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="mk-label">Projects ({repos.length})</h3>
            </div>
            <ul className="max-h-[520px] overflow-y-auto">
              {repos.map(([repo, v]) => {
                const active = repo === activeRepo;
                return (
                  <li key={repo}>
                    <button
                      onClick={() => setSelectedRepo(repo)}
                      className={`w-full text-left px-4 py-3 border-b border-border/50 transition ${active ? "bg-popover text-foreground" : "text-muted-foreground hover:bg-popover/50"}`}
                    >
                      <div className="font-mono text-[13px] truncate">{repo}</div>
                      <div className="text-[10px] mt-0.5">
                        {v.sessions} sessions · {fmt(v.tokensOut)} out ·{" "}
                        <span className="font-mono">{new Date(v.lastActive).toISOString().slice(0, 10)}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Sessions for the selected repo */}
          <div>
            {activeRepo ? (
              <SessionsList sessions={rows} canViewPrompts />
            ) : (
              <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground text-sm">
                Pick a project on the left.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SourceTab({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 mk-label transition border-b-2 ${active ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      {label} <span className={`ml-2 mk-numeric text-[10px] ${active ? "text-accent" : "text-muted-foreground"}`}>{count}</span>
    </button>
  );
}
