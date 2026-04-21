"use client";
import { useState } from "react";

export default function SetupCollector() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function issue() {
    setLoading(true);
    const r = await fetch("/api/tokens", { method: "POST" });
    const j = await r.json();
    setToken(j.token ?? null);
    setLoading(false);
  }

  return (
    <main className="max-w-2xl mx-auto mt-16 px-6 pb-16">
      <header className="mb-10 pb-5 border-b border-border">
        <div className="mk-eyebrow mb-2">setup</div>
        <h1 className="mk-heading text-3xl font-semibold tracking-[-0.02em]">Collector</h1>
        <p className="mt-2 text-sm text-muted-foreground">Runs locally, reads your Claude Code + Codex session files, uploads to pella-metrics.</p>
      </header>

      <section className="mk-card p-6 mb-4">
        <div className="mk-eyebrow mb-3">01 · get a token</div>
        <button
          onClick={issue}
          disabled={loading || !!token}
          className="mk-label bg-accent text-accent-foreground px-3 py-2 hover:opacity-90 disabled:opacity-60 transition"
        >
          {token ? "token issued" : loading ? "issuing…" : "issue new token"}
        </button>
        {token && (
          <pre className="mt-5 bg-[color:var(--terminal)] border border-border px-4 py-3 font-mono text-xs overflow-x-auto select-all text-accent">{token}</pre>
        )}
        {token && <p className="mk-label mt-3 normal-case tracking-normal">Copy now — it won't be shown again.</p>}
      </section>

      <section className="mk-card p-6">
        <div className="mk-eyebrow mb-3">02 · run it</div>
        <p className="text-sm text-muted-foreground mb-4">One-liner. Node 20+ required. No clone, no install.</p>
        <pre className="bg-[color:var(--terminal)] border border-border px-4 py-3 font-mono text-[11px] leading-relaxed overflow-x-auto select-all">
          <span className="text-[color:var(--ink-faint)]">$ </span>
          <span className="text-ink">curl -fsSL https://pella-web-production.up.railway.app/collector.mjs | node - --token </span>
          <span className="text-accent">{token ?? "YOUR_TOKEN"}</span>
        </pre>
        <p className="mk-label mt-4 normal-case tracking-normal">
          Reads <code className="text-foreground font-mono">~/.claude/projects/**</code> and <code className="text-foreground font-mono">~/.codex/sessions/**</code>, resolves each session's cwd to a GitHub repo, uploads to this org.
        </p>
      </section>
    </main>
  );
}
