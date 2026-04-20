import type { Metadata } from "next";
import Link from "next/link";
import { CardMount } from "../_card/CardMount";
import { DEMO_CARD } from "../_card/demo-data";
import { BrandMonolith } from "../_components/BrandMonolith";
import { DashboardShot } from "../_components/DashboardShot";
import { DemoVideo } from "../_components/DemoVideo";
import { HeroGrid } from "../_components/HeroGrid";

const HOME_TITLE = "Bematist · Measure agentic engineering output";
const HOME_DESCRIPTION =
  "Measure agentic engineering output. See the spend. See the work. Scale what ships. Open-source analytics across Claude Code, Codex and the rest of your dev-AI stack.";

export const metadata: Metadata = {
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  alternates: { canonical: "/home" },
  openGraph: {
    type: "website",
    url: "/home",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    site: "@bematist_dev",
  },
};

const ADAPTERS = [
  {
    name: "Claude Code",
    status: "Full",
    tone: "ok",
    captures: "Sessions, input/output/cache tokens, models, tool calls, accepted edits",
  },
  {
    name: "Codex",
    status: "Full",
    tone: "ok",
    captures: "Sessions, per-turn token diffs, tool executions, dollar cost",
  },
  {
    name: "Cursor",
    status: "In dev",
    tone: "warn",
    captures:
      "Messages, lines suggested, accept rate. Subscription-billed — no per-request cost exposed.",
  },
  {
    name: "Continue.dev",
    status: "In dev",
    tone: "warn",
    captures: "Chat turns, token generation, edit outcomes, tool usage",
  },
  {
    name: "OpenCode",
    status: "In dev",
    tone: "warn",
    captures: "Sessions, tokens, model routing (SQLite, post-v1.2)",
  },
  {
    name: "VS Code (generic SDK)",
    status: "In dev",
    tone: "warn",
    captures: "Pluggable handlers via SDK — community adapters supported",
  },
] as const;

const FEATURES = [
  {
    eyebrow: "01",
    title: "Track every dollar across the stack",
    body: "The collector auto-detects coding agents on the engineer's machine, parses native session files locally, and normalizes spend across models. Pricing pinned at capture, so model-price shifts don't silently rewrite history.",
  },
  {
    eyebrow: "02",
    title: "See what AI is actually shipping",
    body: "The GitHub App joins sessions to merged PRs through accepted-edit events, AI-Assisted commit trailers, and a git-log fallback. Cost per merged PR with the commits that earned it. Sessions that shipped vs sessions that burned.",
  },
  {
    eyebrow: "03",
    title: "Replicate the workflows that work",
    body: "Cluster the team's prompts, find the cohort that solved the same problem cheaper, and promote winning workflows as playbooks. The pattern becomes the asset. (Vision — backend live, dashboard gesture lands next.)",
  },
] as const;

const SCORE_DIMENSIONS = [
  {
    tag: "35%",
    name: "Outcome quality",
    body: "Sessions that end in merged code.",
  },
  {
    tag: "25%",
    name: "Efficiency",
    body: "Accepted edits per dollar, peer-normalized.",
  },
  {
    tag: "20%",
    name: "Autonomy",
    body: "How often a session ships without a hand-hold.",
  },
  {
    tag: "10%",
    name: "Adoption depth",
    body: "How many of your agents the engineer actually uses.",
  },
  {
    tag: "10%",
    name: "Team impact",
    body: "Playbooks this engineer promoted that others adopted.",
  },
] as const;

export default function MarketingHome() {
  return (
    <>
      {/* Hero */}
      <section className="mk-hero">
        <HeroGrid />
        <div className="mk-hero-grid">
          <div className="mk-hero-content">
            <div className="mk-sys" style={{ marginBottom: 20 }}>
              open-source. self-hostable.
            </div>
            <h1>
              Measure agentic engineering <em style={{ color: "var(--mk-accent)" }}>output.</em>
            </h1>
            <p>
              See the spend. See the work. Scale what ships. Open-source analytics across Claude
              Code, Codex and the rest of your dev-AI stack.
            </p>
            <div className="mk-hero-actions">
              <Link href="/auth/sign-in?intent=new-org" className="mk-btn mk-btn-primary">
                Sign up with GitHub
              </Link>
              <Link href="/card" className="mk-btn mk-btn-ghost">
                Grab your card
              </Link>
              <a
                href="https://github.com/pella-labs/bematist"
                className="mk-btn mk-btn-ghost"
                rel="noreferrer"
              >
                View on GitHub
              </a>
            </div>
          </div>
          <div className="mk-hero-card-slot">
            <CardMount demoData={DEMO_CARD} compact />
          </div>
        </div>
      </section>

      {/* Demo video */}
      <DemoVideo />

      {/* Dashboard screenshot */}
      <DashboardShot />

      {/* Brand monolith */}
      <BrandMonolith />

      {/* Features — three core capabilities at a glance */}
      <section aria-label="What it does">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs">01 / The product</span>
        </div>
        <div className="mk-features">
          {FEATURES.map((f) => (
            <div key={f.title} className="mk-feature">
              <span className="mk-feature-index">{f.eyebrow}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Adapters — beat 01: see the spend */}
      <section>
        <div className="mk-section-header">
          <span className="mk-mono mk-xs">02 / See the spend · every agent, every token</span>
        </div>
        <table className="mk-table">
          <thead>
            <tr>
              <th>Adapter</th>
              <th>Status</th>
              <th>What it captures</th>
            </tr>
          </thead>
          <tbody>
            {ADAPTERS.map((row) => (
              <tr key={row.name}>
                <td style={{ color: "var(--mk-ink)" }}>{row.name}</td>
                <td data-label="Status">
                  <span className={`mk-badge ${row.tone === "warn" ? "warn" : "full"}`}>
                    {row.status}
                  </span>
                </td>
                <td className="mk-muted" data-label="Captures">
                  {row.captures}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Primary metric — beat 02: see the work */}
      <div className="mk-section-header">
        <span className="mk-mono mk-xs">03 / See the work · spend tied to merged code</span>
      </div>
      <section className="mk-metric" aria-label="Outcome metric">
        <div className="mk-metric-visual">
          <span className="mk-sys">OUTCOME METRIC</span>
          <div className="mk-metric-value">14.2x</div>
          <div className="mk-metric-label">
            <strong>accepted edits per dollar</strong>
            <br />
            GitHub App joins sessions to merged PRs. Pricing pinned at capture. Reverts subtract.
          </div>
        </div>
        <div className="mk-metric-details">
          <span className="mk-sys">WHAT YOU SEE</span>
          <ul className="mk-kv">
            <li>
              <span>Spend per engineer</span>
              <span>by model, project, day</span>
            </li>
            <li>
              <span>Cost per merged PR</span>
              <span>with the commits that earned it</span>
            </li>
            <li>
              <span>Shipped vs burned</span>
              <span>sessions, workflows, repos</span>
            </li>
          </ul>
        </div>
      </section>

      {/* AI Leverage Score — beat 03: scale what ships */}
      <section aria-label="AI Leverage Score">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs">04 / Scale what ships · AI Leverage Score v1</span>
        </div>
        <div className="mk-score-grid">
          {SCORE_DIMENSIONS.map((d) => (
            <div key={d.name} className="mk-score-cell">
              <span className="mk-score-weight">{d.tag}</span>
              <h3>{d.name}</h3>
              <p>{d.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Install CTA — full runbook lives on /install */}
      <section className="mk-terminal-wrap" aria-labelledby="install-cta">
        <span className="mk-sys" style={{ display: "block", marginBottom: 12 }} id="install-cta">
          05 / Install
        </span>
        <div className="mk-terminal" style={{ marginBottom: 20 }}>
          <div className="mk-term-comment">
            # Five minutes to first event — signed binary, no proxy, no API keys.
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">docker compose up -d</span>
            <span className="mk-term-comment">&nbsp;&nbsp;# backend</span>
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">brew install pella-labs/bematist/bematist</span>
            <span className="mk-term-comment">&nbsp;&nbsp;# collector</span>
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">bematist dry-run && bematist serve</span>
          </div>
        </div>
      </section>

      {/* Closing quote */}
      <section className="mk-closing" aria-label="Closing">
        <div className="mk-closing-inner">
          <p className="mk-closing-quote">
            The most expensive system your engineering org has ever bought may be the one you
            understand the least.
          </p>
          <p className="mk-closing-body">
            Bematist measures it. Spend across every agent. Outcomes tied to merged code. The
            prompts that ship, surfaced and shareable. Open-source, self-hostable, runs against your
            local sessions on day one. The data was always yours — now it's an instrument.
          </p>
          <div className="mk-closing-actions">
            <Link href="/card" className="mk-btn mk-btn-primary">
              Grab your card
            </Link>
            <a
              href="https://x.com/bematist_dev"
              className="mk-btn mk-btn-ghost"
              rel="noreferrer"
              target="_blank"
            >
              Follow on X
            </a>
          </div>
        </div>
      </section>

      {/* License */}
      <section className="mk-license">
        <span className="mk-sys">06 / License</span>
        <div className="mk-license-body">
          <strong>Apache 2.0</strong> for the collector, dashboard, adapters, schemas, and CLI.
          <br />
          <strong>BSL 1.1</strong> for the managed-cloud gateway and admin surfaces. Converts to
          Apache 2.0 after four years.
        </div>
      </section>
    </>
  );
}
