"use client";
import { useState } from "react";
import BackButton from "@/components/back-button";
import CopyButton from "@/components/copy-button";

const WEB_URL = "https://pellametric.com";

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

  const shCmd = token
    ? `curl -fsSL ${WEB_URL}/install.sh | sh -s -- --token ${token}`
    : "";
  const ps1Cmd = token
    ? `$env:PELLA_TOKEN="${token}"; irm ${WEB_URL}/install.ps1 | iex`
    : "";
  const mjsCmd = token
    ? `curl -fsSL ${WEB_URL}/collector.mjs | node - --token ${token}`
    : "";

  return (
    <main className="max-w-xl mx-auto mt-8 px-6 pb-16">
      <header className="flex items-start gap-4 mb-10 pb-5 border-b border-border">
        <BackButton href="/dashboard" />
        <div>
          <div className="mk-eyebrow mb-2">setup</div>
          <h1 className="mk-heading text-3xl font-semibold tracking-[-0.02em]">Collector</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Runs locally as a background service. Streams new Claude Code + Codex sessions as
            they happen. Starts automatically at login.
          </p>
        </div>
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
          <>
            <div className="mt-5 flex items-start gap-2">
              <pre className="flex-1 bg-[color:var(--terminal)] border border-border px-4 py-3 font-mono text-xs overflow-x-auto select-all text-accent min-w-0">
                {token}
              </pre>
              <CopyButton text={token} label="copy token" />
            </div>
            <p className="mk-label mt-3 normal-case tracking-normal">Copy now — it won't be shown again.</p>
          </>
        )}
      </section>

      {token && (
        <>
          <section className="mk-card p-6 mb-4">
            <div className="mk-eyebrow mb-3">02 · install &amp; run</div>
            <p className="text-sm text-muted-foreground mb-4">
              Downloads the binary, installs it as a per-user service, and starts streaming
              immediately. Detaches from the terminal and auto-starts on every login.
            </p>

            <div className="mk-label mb-2 normal-case tracking-normal text-muted-foreground">macOS / Linux</div>
            <div className="flex items-start gap-2">
              <pre className="flex-1 bg-[color:var(--terminal)] border border-border px-4 py-3 font-mono text-[11px] leading-relaxed overflow-x-auto select-all min-w-0">
                <span className="text-[color:var(--ink-faint)]">$ </span>
                <span className="text-ink">curl -fsSL {WEB_URL}/install.sh | sh -s -- --token </span>
                <span className="text-accent">{token}</span>
              </pre>
              <CopyButton text={shCmd} label="copy command" />
            </div>

            <div className="mk-label mt-5 mb-2 normal-case tracking-normal text-muted-foreground">Windows (PowerShell)</div>
            <div className="flex items-start gap-2">
              <pre className="flex-1 bg-[color:var(--terminal)] border border-border px-4 py-3 font-mono text-[11px] leading-relaxed overflow-x-auto select-all min-w-0">
                <span className="text-[color:var(--ink-faint)]">&gt; </span>
                <span className="text-ink">$env:PELLA_TOKEN=</span>
                <span className="text-accent">"{token}"</span>
                <span className="text-ink">; irm {WEB_URL}/install.ps1 | iex</span>
              </pre>
              <CopyButton text={ps1Cmd} label="copy command" />
            </div>

            <p className="mk-label mt-4 normal-case tracking-normal">
              Reads <code className="text-foreground font-mono">~/.claude/projects/**</code> and{" "}
              <code className="text-foreground font-mono">~/.codex/sessions/**</code>, resolves each
              session's cwd to a GitHub repo, and uploads to this org.
            </p>
          </section>

          <section className="mk-card p-6">
            <div className="mk-eyebrow mb-3">03 · advanced · one-shot backfill</div>
            <p className="text-sm text-muted-foreground mb-4">
              Uploads history once and exits. No binary, no auto-start. Use this to sanity-check
              your token, or from a machine where you can't install a service.
            </p>
            <div className="flex items-start gap-2">
              <pre className="flex-1 bg-[color:var(--terminal)] border border-border px-4 py-3 font-mono text-[11px] leading-relaxed overflow-x-auto select-all min-w-0">
                <span className="text-[color:var(--ink-faint)]">$ </span>
                <span className="text-ink">curl -fsSL {WEB_URL}/collector.mjs | node - --token </span>
                <span className="text-accent">{token}</span>
              </pre>
              <CopyButton text={mjsCmd} label="copy command" />
            </div>
          </section>
        </>
      )}
    </main>
  );
}
