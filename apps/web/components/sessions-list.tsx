"use client";

import { useEffect, useState } from "react";

function fmt(n: number) {
  if (!n) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

type Session = {
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

export default function SessionsList({ sessions, canViewPrompts }: { sessions: Session[]; canViewPrompts: boolean }) {
  const [open, setOpen] = useState<Session | null>(null);

  return (
    <>
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="mk-label">Sessions ({sessions.length})</h3>
          {canViewPrompts && (
            <span className="text-[10px] text-muted-foreground normal-case tracking-normal">
              click a row to see your prompts (owner-only, end-to-end encrypted)
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3">Started</th>
                <th className="text-left py-2 px-3">Source</th>
                <th className="text-left py-2 px-3">Repo</th>
                <th className="text-left py-2 px-3">Intent</th>
                <th className="text-right py-2 px-3">Prompts</th>
                <th className="text-right py-2 px-3">Msgs</th>
                <th className="text-right py-2 px-3">Tokens</th>
                <th className="text-right py-2 px-3">Files</th>
                <th className="text-right py-2 px-3">Err</th>
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 500).map(s => (
                <tr
                  key={s.id}
                  onClick={() => canViewPrompts && setOpen(s)}
                  className={`border-b border-border/50 hover:bg-popover/40 ${canViewPrompts ? "cursor-pointer" : ""}`}
                >
                  <td className="py-1.5 px-3 font-mono text-muted-foreground">
                    {new Date(s.startedAt).toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="py-1.5 px-3">
                    <span className="text-[10px] px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">{s.source}</span>
                  </td>
                  <td className="py-1.5 px-3 font-mono text-muted-foreground">{s.repo}</td>
                  <td className="py-1.5 px-3">{s.intentTop ?? "—"}</td>
                  <td className="py-1.5 px-3 text-right">{s.userTurns ?? "—"}</td>
                  <td className="py-1.5 px-3 text-right">{s.messages}</td>
                  <td className="py-1.5 px-3 text-right">{fmt(Number(s.tokensOut))}</td>
                  <td className="py-1.5 px-3 text-right">{Array.isArray(s.filesEdited) ? s.filesEdited.length : 0}</td>
                  <td className={`py-1.5 px-3 text-right ${s.errors > 0 ? "text-warning" : ""}`}>{s.errors}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {open && <PromptDrawer session={open} onClose={() => setOpen(null)} />}
    </>
  );
}

type Turn = { kind: "prompt" | "response"; id: string; ts: string; wordCount: number; text: string };

function PromptDrawer({ session, onClose }: { session: Session; onClose: () => void }) {
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState<string>("");
  const [turns, setTurns] = useState<Turn[]>([]);

  useEffect(() => {
    const ac = new AbortController();
    const q = new URLSearchParams({ source: session.source, externalSessionId: session.externalSessionId });
    fetch(`/api/prompts?${q.toString()}`, { signal: ac.signal, cache: "no-store" })
      .then(async r => {
        if (!r.ok) throw new Error(`http ${r.status}`);
        const j = await r.json();
        setTurns(j.turns ?? []);
        setState("ready");
      })
      .catch(e => {
        if (e.name === "AbortError") return;
        setErr(String(e.message ?? e));
        setState("error");
      });
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { ac.abort(); window.removeEventListener("keydown", onKey); };
  }, [session.externalSessionId, session.source, onClose]);

  const promptCount = turns.filter(t => t.kind === "prompt").length;
  const responseCount = turns.filter(t => t.kind === "response").length;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl h-full bg-background border-l border-border overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-background border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <div className="min-w-0">
            <div className="mk-label text-muted-foreground">session · {session.source}</div>
            <div className="mk-heading text-base mt-1 truncate">{session.repo}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">
              {new Date(session.startedAt).toISOString().replace("T", " ").slice(0, 19)} · {session.externalSessionId.slice(0, 8)}
            </div>
            {state === "ready" && (
              <div className="text-[11px] text-muted-foreground mt-1">
                {promptCount} prompts · {responseCount} responses
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="mk-label border border-border px-3 py-1.5 rounded hover:bg-popover transition shrink-0 ml-3"
          >
            close · esc
          </button>
        </div>

        <div className="px-5 py-5 space-y-3">
          {state === "loading" && <div className="text-sm text-muted-foreground">Loading…</div>}
          {state === "error" && <div className="text-sm text-destructive">Failed: {err}</div>}
          {state === "ready" && turns.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No conversation stored for this session yet. Re-run the collector to upload it.
            </div>
          )}
          {state === "ready" && turns.map(t => (
            <TurnCard key={t.id} turn={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Claude Code wraps shell invocations in <bash-input>/<bash-stdout>/<bash-stderr>
// tags inside message content. Strip them to readable form: commands prefixed
// with `$ `, empty output omitted, stderr inlined.
function cleanPromptText(raw: string): string {
  return raw
    .replace(/<bash-input>([\s\S]*?)<\/bash-input>/g, (_, cmd) => `$ ${cmd.trim()}`)
    .replace(/<bash-stdout>([\s\S]*?)<\/bash-stdout>/g, (_, out) => {
      const t = out.trim();
      return t ? t : "";
    })
    .replace(/<bash-stderr>([\s\S]*?)<\/bash-stderr>/g, (_, err) => {
      const t = err.trim();
      return t ? t : "";
    })
    // collapse the blank lines we may have produced
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function TurnCard({ turn }: { turn: Turn }) {
  const isPrompt = turn.kind === "prompt";
  const label = isPrompt ? "you" : "assistant";
  const align = isPrompt ? "justify-end" : "justify-start";
  const bubble = isPrompt
    ? "border border-border bg-card text-foreground"
    : "border border-accent bg-accent text-accent-foreground";
  const headerBorder = isPrompt ? "border-border/60" : "border-accent-foreground/20";
  const headerMuted = isPrompt ? "text-muted-foreground" : "text-accent-foreground/70";
  const text = cleanPromptText(turn.text);
  if (!text) return null;
  return (
    <div className={`flex ${align}`}>
      <div className={`max-w-[88%] rounded-md ${bubble}`}>
        <div className={`px-4 py-2 border-b text-[11px] font-mono ${headerBorder}`}>
          <span className={headerMuted}>
            {label} · {new Date(turn.ts).toISOString().replace("T", " ").slice(0, 19)}
          </span>
        </div>
        <pre className="px-4 py-3 text-[13px] whitespace-pre-wrap break-words font-sans leading-snug">{text}</pre>
      </div>
    </div>
  );
}
