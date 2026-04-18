import type { Metadata } from "next";
import Link from "next/link";
import { DEMO_CARD } from "../_card/demo-data";
import { BrandMonolith } from "../_components/BrandMonolith";
import { DashboardShot } from "../_components/DashboardShot";
import { HeroGrid } from "../_components/HeroGrid";
import { WrappedCard } from "../_components/WrappedCard";

const HOME_TITLE = "Bematist · The dashboard for AI-assisted engineering";
const HOME_DESCRIPTION =
  "Bematist is the dashboard for teams building with coding agents. Your personal card is the 30-second hook. The dashboard is where you see where every dollar lands, which workflows compound, and which wins are worth copying.";

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
  },
};

const ADAPTERS = [
  {
    name: "Claude Code",
    iface: "CLI",
    notes: "Full native OTEL. Tokens, envelopes, tool calls, timings.",
  },
  {
    name: "Cursor",
    iface: "IDE",
    notes: "Edits, diff sizes, model routing, acceptance decisions.",
  },
  {
    name: "Codex CLI",
    iface: "CLI",
    notes: "JSONL session tail with cumulative token diffs.",
  },
] as const;

const FEATURES = [
  {
    eyebrow: "01",
    title: "Dashboard you'll actually open",
    body: "Spend by project, by developer, by week. Which agents produced the wins. Which prompts keep paying off. A surface your team will return to on Monday morning.",
  },
  {
    eyebrow: "02",
    title: "Spend, tied to shipped code",
    body: "Every accepted edit joins a git commit. Every commit joins a merged PR. You see cost per shipped change, not cost per token.",
  },
  {
    eyebrow: "03",
    title: "Shareable cards on the way in",
    body: "A personal card lands as soon as the collector runs — fun to share, fast to try. The real depth is the dashboard, where the card data keeps working for you and your team.",
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
              open-source. forever.
            </div>
            <h1>
              See what AI is <em>actually shipping</em>.
            </h1>
            <p>
              Bematist is the dashboard for teams building with coding agents. See where every
              dollar lands, which workflows compound, and the wins your team should be copying.
              Start with a personal card in 30 seconds — the dashboard is where you stay.
            </p>
            <div className="mk-hero-actions">
              <Link href="/demo" className="mk-btn mk-btn-primary">
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
          <WrappedCard data={DEMO_CARD} />
        </div>
      </section>

      {/* Dashboard screenshot */}
      <DashboardShot />

      {/* Brand monolith */}
      <BrandMonolith />

      {/* Features */}
      <section aria-label="What the dashboard does">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs">01 / What the dashboard does</span>
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
      <section id="adapters">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs">02 / Supported agents</span>
        </div>
        <table className="mk-table">
          <thead>
            <tr>
              <th>Target</th>
              <th>Interface</th>
              <th>Status</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {ADAPTERS.map((row) => (
              <tr key={row.name}>
                <td style={{ color: "var(--mk-ink)" }}>{row.name}</td>
                <td className="mk-muted">{row.iface}</td>
                <td>
                  <span className="mk-badge full">Full</span>
                </td>
                <td className="mk-muted">{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Primary metric */}
      <section className="mk-metric" aria-label="Primary metric">
        <div className="mk-metric-visual">
          <span className="mk-sys">PRIMARY METRIC</span>
          <div className="mk-metric-value">14.2x</div>
          <div className="mk-metric-label">
            <strong>accepted_code_edits_per_dollar</strong>
            <br />
            Joined across session, commit, and merged PR. Reverted hunks subtracted. Pricing version
            pinned per capture.
          </div>
        </div>
        <div className="mk-metric-details">
          <span className="mk-sys">ATTRIBUTION</span>
          <ul className="mk-kv">
            <li>
              <span>Session event</span>
              <span>code_edit_tool.decision=accept</span>
            </li>
            <li>
              <span>Commit marker</span>
              <span>opt-in AI-Assisted trailer</span>
            </li>
            <li>
              <span>Merge validation</span>
              <span>GitHub webhook (HMAC)</span>
            </li>
            <li>
              <span>Revert window</span>
              <span>24h</span>
            </li>
            <li>
              <span>Dedup unit</span>
              <span>(session_id, hunk_sha256)</span>
            </li>
          </ul>
        </div>
      </section>

      {/* Privacy (condensed to three product-benefit cards) */}
      <section id="privacy">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs">03 / Capture modes</span>
        </div>
        <div className="mk-tiers">
          <div className="mk-tier">
            <span className="mk-tier-label">MINIMAL</span>
            <h3>Counters</h3>
            <p>
              Tokens, sessions, durations, routing. No payloads. For teams under the strictest
              policies.
            </p>
          </div>
          <div className="mk-tier active">
            <span className="mk-tier-label">DEFAULT</span>
            <h3>Envelopes</h3>
            <p>
              Counters plus secret-scrubbed prompt shape and file context. Enough to cluster work,
              never enough to read it.
            </p>
          </div>
          <div className="mk-tier">
            <span className="mk-tier-label">DIAGNOSTIC</span>
            <h3>Full prompts</h3>
            <p>
              Opt-in per project by the engineer, or tenant-wide with signed config and cooldown.
              Off by default.
            </p>
          </div>
        </div>
      </section>

      {/* Install */}
      <section id="install" className="mk-terminal-wrap">
        <span className="mk-sys" style={{ display: "block", marginBottom: 20 }}>
          04 / Install
        </span>
        <div className="mk-terminal">
          <div className="mk-term-comment"># 1. Pull your tenant backend</div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">
              curl -fsSL https://get.bematist.dev/compose.yml {">"} docker-compose.yml
            </span>
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">docker compose up -d</span>
          </div>
          <br />
          <div className="mk-term-comment"># 2. Install the local collector</div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">brew install pella-labs/bematist/bematist</span>
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">bematist install --auto-detect</span>
          </div>
          <br />
          <div className="mk-term-comment"># 3. Open the dashboard</div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">open http://localhost:9873</span>
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
