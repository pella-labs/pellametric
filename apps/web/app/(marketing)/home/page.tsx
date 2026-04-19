import type { Metadata } from "next";
import Link from "next/link";
import { CardMount } from "../_card/CardMount";
import { DEMO_CARD } from "../_card/demo-data";
import { BrandMonolith } from "../_components/BrandMonolith";
import { DashboardShot } from "../_components/DashboardShot";
import { HeroGrid } from "../_components/HeroGrid";

const HOME_TITLE = "Bematist · The instrument for AI-assisted engineering";
const HOME_DESCRIPTION =
  "Bematist is the analytics platform for AI-assisted software development. See where every dollar lands, which workflows ship code, and the patterns worth copying across your team.";

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
    iface: "CLI",
    captures: "Sessions · input/output/cache tokens · models · tool calls · accepted edits",
  },
  {
    name: "Cursor",
    iface: "IDE",
    captures: "Generations · accept/reject · mode (auto/manual) · estimated cost",
  },
  {
    name: "Codex CLI",
    iface: "CLI",
    captures: "Sessions · per-turn token diffs · tool executions · cost",
  },
  {
    name: "Continue.dev",
    iface: "IDE",
    captures: "Chat turns · token generation · edit outcomes · tool usage (four streams)",
  },
  {
    name: "OpenCode",
    iface: "CLI",
    captures: "Sessions · tokens · model routing (SQLite, post-v1.2)",
  },
  {
    name: "VS Code extensions",
    iface: "IDE",
    captures: "Pluggable handlers via SDK — Twinny shipped, community adapters supported",
  },
] as const;

const FEATURES = [
  {
    eyebrow: "01",
    title: "One binary, every coding agent",
    body: "The collector auto-detects six agents on the machine — Claude Code, Cursor, Codex, Continue.dev, OpenCode, VS Code — and reads their native session files. No API keys to proxy, no plugins to install, no dev workflow to change.",
  },
  {
    eyebrow: "02",
    title: "A personal card that actually means something",
    body: "Sessions, input tokens, output tokens, cache read + create tokens, dollar-value cache savings, models used, tools called, repos touched, hourly + 160-day daily distributions. All pulled from your real local sessions.",
  },
  {
    eyebrow: "03",
    title: "Seven dashboard surfaces, end-to-end wired",
    body: "Summary · Sessions · Outcomes · Clusters · Insights · Teams · Me. Every page's read path is written and tested; fixture data today, ClickHouse MVs as your pipeline lands.",
  },
] as const;

const SCORE_DIMENSIONS = [
  {
    tag: "35%",
    name: "Outcome quality",
    body: "Sessions that end in a merged change vs sessions that burn tokens with nothing to show.",
  },
  {
    tag: "25%",
    name: "Efficiency",
    body: "Accepted edits per dollar of model spend, cohort-normalized against peers doing similar work.",
  },
  {
    tag: "20%",
    name: "Autonomy",
    body: "One minus the intervention rate — how often a session needs a hand-hold vs ships on its own.",
  },
  {
    tag: "10%",
    name: "Adoption depth",
    body: "How many agents and workflows the engineer actually uses, not just the one that opened last.",
  },
  {
    tag: "10%",
    name: "Team impact",
    body: "Playbooks this engineer promoted that other engineers adopted — capped, verifiable, opt-in.",
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
              Where is all your AI money <em>actually going</em>?
            </h1>
            <p>
              AI coding agents are exploding across engineering teams — Claude Code, Cursor, Codex.
              Spend is up, usage is everywhere, but the answer to "what are we getting back" is
              still a black box. Bematist makes that system legible. Start with a personal card in
              30 seconds; the dashboard is where your team lives.
            </p>
            <div className="mk-hero-actions">
              <Link href="/card" className="mk-btn mk-btn-primary">
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

      {/* Dashboard screenshot */}
      <DashboardShot />

      {/* Brand monolith */}
      <BrandMonolith />

      {/* Features */}
      <section aria-label="What the dashboard does">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs">01 / What Bematist gives you</span>
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

      {/* Adapters */}
      <section>
        <div className="mk-section-header">
          <span className="mk-mono mk-xs">02 / Six agents, parsing real session files today</span>
        </div>
        <table className="mk-table">
          <thead>
            <tr>
              <th>Target</th>
              <th>Interface</th>
              <th>What it captures</th>
            </tr>
          </thead>
          <tbody>
            {ADAPTERS.map((row) => (
              <tr key={row.name}>
                <td style={{ color: "var(--mk-ink)" }}>{row.name}</td>
                <td className="mk-muted">{row.iface}</td>
                <td className="mk-muted">{row.captures}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Primary metric */}
      <section className="mk-metric" aria-label="Outcome metric">
        <div className="mk-metric-visual">
          <span className="mk-sys">OUTCOME METRIC</span>
          <div className="mk-metric-value">14.2x</div>
          <div className="mk-metric-label">
            <strong>accepted edits per dollar</strong>
            <br />
            Dedup unit is (session_id, hunk_sha256). Denominator window is the session. Reverts
            within 24h subtract. Pricing pinned at capture time, so model-price shifts don't
            silently rewrite history.
          </div>
        </div>
        <div className="mk-metric-details">
          <span className="mk-sys">WHAT THE DASHBOARD SHOWS</span>
          <ul className="mk-kv">
            <li>
              <span>/summary</span>
              <span>spend, accepted edits, merged PRs, $/edit</span>
            </li>
            <li>
              <span>/sessions</span>
              <span>every session, tokens, tools, cost</span>
            </li>
            <li>
              <span>/outcomes</span>
              <span>cost per merged PR, commit join</span>
            </li>
            <li>
              <span>/clusters</span>
              <span>similar prompts + twin finder</span>
            </li>
            <li>
              <span>/insights</span>
              <span>anomalies + weekly digest</span>
            </li>
          </ul>
        </div>
      </section>

      {/* AI Leverage Score */}
      <section aria-label="AI Leverage Score">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs">03 / AI Leverage Score v1 · ai_leverage_v1</span>
        </div>
        <div className="mk-score-grid">
          {SCORE_DIMENSIONS.map((d) => (
            <div key={d.name} className="mk-score-cell">
              <span className="mk-score-weight">{d.tag}</span>
              <h3>{d.name}</h3>
              <p>{d.body}</p>
            </div>
          ))}
          <div className="mk-score-cell mk-score-gate">
            <span className="mk-score-weight">GATES</span>
            <h3>No number, no gate</h3>
            <p>
              A score renders only when all four hold: ≥10 sessions, ≥5 active days, ≥3 outcome
              events, cohort ≥8 peers. Below any of them, the tile says "insufficient data" and
              names the gate that failed — never interpolated, never estimated.
            </p>
          </div>
        </div>
      </section>

      {/* Install CTA — full runbook lives on /install */}
      <section className="mk-terminal-wrap" aria-labelledby="install-cta">
        <span className="mk-sys" style={{ display: "block", marginBottom: 12 }} id="install-cta">
          04 / Install
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
        <Link href="/install" className="mk-btn mk-btn-ghost">
          Full install runbook →
        </Link>
      </section>

      {/* Closing quote */}
      <section className="mk-closing" aria-label="Closing">
        <div className="mk-closing-inner">
          <p className="mk-closing-quote">
            The most expensive system your engineering org has ever bought may be the one you
            understand the least.
          </p>
          <p className="mk-closing-body">
            Bematist is the instrument for measuring it. One open-source platform that makes AI
            spend legible, accountable, and tied to real engineering outcomes. The data was always
            yours. We just made it legible.
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
        <span className="mk-sys">05 / License</span>
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
