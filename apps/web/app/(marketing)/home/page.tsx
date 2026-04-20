import type { Metadata } from "next";
import Link from "next/link";
import { CardMount } from "../_card/CardMount";
import { DEMO_CARD } from "../_card/demo-data";
import { BrandMonolith } from "../_components/BrandMonolith";
import { DashboardShot } from "../_components/DashboardShot";
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
      "Messages, lines suggested, accept rate. Cost shown as $0 — Cursor is subscription-billed and exposes no per-request pricing.",
  },
  {
    name: "Continue.dev",
    status: "Full",
    tone: "ok",
    captures: "Chat turns, token generation, edit outcomes, tool usage",
  },
  {
    name: "OpenCode",
    status: "Full",
    tone: "ok",
    captures: "Sessions, tokens, model routing (SQLite, post-v1.2)",
  },
  {
    name: "VS Code (generic SDK)",
    status: "Full",
    tone: "ok",
    captures: "Pluggable handlers — Twinny shipped, community adapters supported",
  },
] as const;

const SCORE_DIMENSIONS = [
  {
    tag: "35%",
    name: "Outcome quality",
    body: "Sessions that end in merged code. Not started, not attempted — merged.",
  },
  {
    tag: "25%",
    name: "Efficiency",
    body: "Accepted edits per dollar, normalized against peers doing similar work.",
  },
  {
    tag: "20%",
    name: "Autonomy",
    body: "How often a session ships without a hand-hold. One minus the intervention rate.",
  },
  {
    tag: "10%",
    name: "Adoption depth",
    body: "How many of your agents and workflows the engineer actually uses.",
  },
  {
    tag: "10%",
    name: "Team impact",
    body: "Playbooks this engineer promoted that the rest of the team adopted.",
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

      {/* Dashboard screenshot */}
      <DashboardShot />

      {/* Brand monolith */}
      <BrandMonolith />

      {/* Adapters — pillar 01: see the spend */}
      <section>
        <div className="mk-section-header">
          <span className="mk-mono mk-xs">01 / See the spend · every agent, every token</span>
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

      {/* Primary metric — pillar 02: see the work */}
      <div className="mk-section-header">
        <span className="mk-mono mk-xs">02 / See the work · spend tied to merged code</span>
      </div>
      <section className="mk-metric" aria-label="Outcome metric">
        <div className="mk-metric-visual">
          <span className="mk-sys">OUTCOME METRIC</span>
          <div className="mk-metric-value">14.2x</div>
          <div className="mk-metric-label">
            <strong>accepted edits per dollar</strong>
            <br />
            The GitHub App joins sessions to PRs through accepted-edit events, AI-Assisted commit
            trailers, and a git-log fallback — so you know what shipped and what just burned tokens.
            Pricing pinned at capture, reverts within 24h subtract.
          </div>
        </div>
        <div className="mk-metric-details">
          <span className="mk-sys">WHAT YOU SEE</span>
          <ul className="mk-kv">
            <li>
              <span>Spend per engineer</span>
              <span>daily, weekly, by model and project</span>
            </li>
            <li>
              <span>Cost per merged PR</span>
              <span>with the commits that earned it</span>
            </li>
            <li>
              <span>Sessions that shipped</span>
              <span>vs sessions that burned</span>
            </li>
            <li>
              <span>Twin prompts</span>
              <span>workflows that solved the same task cheaper</span>
            </li>
            <li>
              <span>Weekly digest</span>
              <span>what changed, what to do about it</span>
            </li>
          </ul>
        </div>
      </section>

      {/* Twin Finder — pillar 03: scale what ships (the unlock) */}
      <div className="mk-section-header">
        <span className="mk-mono mk-xs">03 / Scale what ships · Twin Finder</span>
      </div>
      <section className="mk-metric" aria-label="Twin Finder">
        <div className="mk-metric-visual">
          <span className="mk-sys">THE UNLOCK</span>
          <h2
            style={{
              fontSize: "clamp(28px, 3.4vw, 44px)",
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              margin: "8px 0 16px",
            }}
          >
            Find the workflow that ships.{" "}
            <em style={{ color: "var(--mk-accent)" }}>Replicate it.</em>
          </h2>
          <div className="mk-metric-label">
            Every prompt gets redacted and abstracted on-device, embedded, and clustered against the
            rest of the team. Twin Finder pulls the cohort that solved the same problem you're
            solving — and surfaces the engineers who solved it cheaper. The pattern is the asset.
          </div>
        </div>
        <div className="mk-metric-details">
          <span className="mk-sys">HOW IT WORKS</span>
          <ul className="mk-kv">
            <li>
              <span>Cluster</span>
              <span>nightly k-means across prompt embeddings</span>
            </li>
            <li>
              <span>Compare</span>
              <span>similarity search inside your cluster</span>
            </li>
            <li>
              <span>Surface</span>
              <span>the cohort that solved it for less</span>
            </li>
            <li>
              <span>Promote</span>
              <span>turn the winning prompt into a team playbook</span>
            </li>
          </ul>
        </div>
      </section>

      {/* AI Leverage Score */}
      <section aria-label="AI Leverage Score">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs">04 / The manager's number · AI Leverage Score v1</span>
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
