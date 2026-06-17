"use client";
import { useState } from "react";
import BackButton from "@/components/back-button";
import CopyButton from "@/components/copy-button";

const WEB_URL = process.env.NEXT_PUBLIC_BETTER_AUTH_URL || "https://pellametric.com";

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
    ? `curl -fsSL ${WEB_URL}/install.sh | sh -s -- --token ${token} --url ${WEB_URL}`
    : "";
  const ps1Cmd = token
    ? `$env:PELLA_TOKEN="${token}"; $env:PELLA_URL="${WEB_URL}"; irm ${WEB_URL}/install.ps1 | iex`
    : "";
  const mjsCmd = token
    ? `curl -fsSL ${WEB_URL}/collector.mjs | node - --token ${token} --url ${WEB_URL}`
    : "";

  return (
    <main className="max-w-2xl mx-auto pt-20 sm:pt-24 px-4 sm:px-6 pb-20">
      <header className="flex items-start gap-3 sm:gap-4 mb-8 pb-6 border-b border-border">
        <BackButton href="/dashboard" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span
              className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent/15 border border-accent/40"
              aria-hidden
            >
              <CollectorIcon />
            </span>
            <span className="mk-label text-accent">setup · collector</span>
          </div>
          <h1 className="mk-heading text-2xl sm:text-3xl font-semibold tracking-[-0.02em]">
            Collector
          </h1>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Runs locally as a background service. Streams new Claude Code + Codex sessions
            as they happen, and auto-starts on every login.
          </p>
        </div>
      </header>

      <ol className="space-y-1">
        <Step n={1} title="Issue a token" complete={!!token} active={!token}>
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
            One token per machine. We hash and store only the SHA-256 — the plaintext is
            shown once below.
          </p>

          <button
            onClick={issue}
            disabled={loading || !!token}
            className={`mk-label inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg font-medium transition ${
              token
                ? "bg-accent/10 border border-accent/40 text-accent cursor-default"
                : "bg-accent text-accent-foreground hover:opacity-90 disabled:opacity-60 disabled:cursor-wait"
            }`}
          >
            {token ? <CheckMark /> : loading ? <SpinnerIcon /> : <KeyIcon />}
            <span>{token ? "Token issued" : loading ? "Issuing…" : "Issue new token"}</span>
          </button>

          {token && (
            <div className="mt-5">
              <div className="flex items-stretch gap-2">
                <pre className="flex-1 bg-[color:var(--terminal)] border border-border rounded-md px-4 py-3 font-mono text-xs overflow-x-auto select-all text-accent min-w-0">
                  {token}
                </pre>
                <CopyButton text={token} label="copy token" />
              </div>
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-warning">
                <WarnIcon />
                <span>Copy now — this won't be shown again.</span>
              </p>
            </div>
          )}
        </Step>

        <Step n={2} title="Install &amp; run" disabled={!token} active={!!token}>
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
            Downloads the binary, installs it as a per-user service, and starts streaming.
            Detaches from the terminal and auto-starts on every login.
          </p>

          <Terminal
            label="macOS / Linux"
            prompt="$"
            disabled={!token}
            cmd={
              token ? (
                <>
                  <span className="text-ink">curl -fsSL {WEB_URL}/install.sh | sh -s -- --token </span>
                  <span className="text-accent">{token}</span>
                  <span className="text-ink"> --url {WEB_URL}</span>
                </>
              ) : (
                <span className="text-[color:var(--ink-faint)]">issue a token first</span>
              )
            }
            copyText={shCmd}
          />

          <div className="h-3" />

          <Terminal
            label="Windows · PowerShell"
            prompt=">"
            disabled={!token}
            cmd={
              token ? (
                <>
                  <span className="text-ink">$env:PELLA_TOKEN=</span>
                  <span className="text-accent">"{token}"</span>
                  <span className="text-ink">; $env:PELLA_URL="{WEB_URL}"; irm {WEB_URL}/install.ps1 | iex</span>
                </>
              ) : (
                <span className="text-[color:var(--ink-faint)]">issue a token first</span>
              )
            }
            copyText={ps1Cmd}
          />

          <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground border border-border rounded-md px-3 py-2.5 bg-[color:var(--background)]/40">
            <FolderIcon />
            <span className="leading-relaxed">
              Reads{" "}
              <code className="font-mono text-foreground bg-card border border-border rounded px-1.5 py-0.5">
                ~/.claude/projects/**
              </code>{" "}
              and{" "}
              <code className="font-mono text-foreground bg-card border border-border rounded px-1.5 py-0.5">
                ~/.codex/sessions/**
              </code>
              , resolves each session's <em className="not-italic font-mono">cwd</em> to a
              GitHub repo, and uploads it to your org.
            </span>
          </div>
        </Step>

        <Step n={3} title="Advanced · one-shot backfill" last disabled={!token} active={!!token}>
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
            Uploads history once and exits. No binary, no auto-start. Use this to sanity-check
            your token, or from a machine where you can't install a service.
          </p>

          <Terminal
            label="Node"
            prompt="$"
            disabled={!token}
            cmd={
              token ? (
                <>
                  <span className="text-ink">curl -fsSL {WEB_URL}/collector.mjs | node - --token </span>
                  <span className="text-accent">{token}</span>
                  <span className="text-ink"> --url {WEB_URL}</span>
                </>
              ) : (
                <span className="text-[color:var(--ink-faint)]">issue a token first</span>
              )
            }
            copyText={mjsCmd}
          />
        </Step>
      </ol>
    </main>
  );
}

function Step({
  n, title, children, last, complete, active, disabled,
}: {
  n: number; title: string; children: React.ReactNode;
  last?: boolean; complete?: boolean; active?: boolean; disabled?: boolean;
}) {
  return (
    <li className={`flex gap-4 ${disabled ? "opacity-60" : ""}`}>
      <div className="flex flex-col items-center">
        <span
          className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full font-mono text-xs transition ${
            complete
              ? "bg-accent/15 border border-accent/50 text-accent"
              : active
                ? "bg-card border border-accent/40 text-foreground"
                : "bg-card border border-border text-muted-foreground"
          }`}
          aria-hidden
        >
          {complete ? <CheckMark /> : n}
        </span>
        {!last && (
          <span
            className={`w-px flex-1 mt-2 mb-1 ${complete ? "bg-accent/40" : "bg-border"}`}
            aria-hidden
          />
        )}
      </div>
      <div className="flex-1 min-w-0 pb-8">
        <div className="mk-heading font-semibold text-base mb-2">{title}</div>
        {children}
      </div>
    </li>
  );
}

function Terminal({
  label, prompt, cmd, copyText, disabled,
}: {
  label: string; prompt: string; cmd: React.ReactNode; copyText: string; disabled?: boolean;
}) {
  return (
    <div>
      <div className="mk-label normal-case tracking-normal text-muted-foreground mb-1.5">{label}</div>
      <div className="flex items-stretch gap-2">
        <pre className="flex-1 bg-[color:var(--terminal)] border border-border rounded-md px-4 py-3 font-mono text-[11px] leading-relaxed overflow-x-auto select-all min-w-0">
          <span className="text-[color:var(--ink-faint)]">{prompt} </span>
          {cmd}
        </pre>
        {!disabled && copyText && <CopyButton text={copyText} label="copy" />}
      </div>
    </div>
  );
}

function CollectorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-accent">
      <rect x="2" y="3" width="12" height="8" rx="1.5" />
      <path d="M2 7h12" />
      <path d="M5 13.5h6" />
      <path d="M8 11v2.5" />
      <circle cx="4.5" cy="5" r="0.5" fill="currentColor" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="5" cy="11" r="2.5" />
      <path d="M7 9.5l5-5M10.5 6.5l1.5 1.5M9 8l1.5 1.5" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden className="animate-spin">
      <path d="M8 2A6 6 0 0 1 14 8" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2.5L14.5 13.5h-13L8 2.5z" />
      <path d="M8 7v3M8 12v.01" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-accent shrink-0 mt-0.5">
      <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5h5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5z" />
    </svg>
  );
}
