import type { Metadata } from "next";
import Link from "next/link";
import { BrandMonolith } from "../_components/BrandMonolith";
import { HeroGrid } from "../_components/HeroGrid";

export const metadata: Metadata = {
  title: "Bematist — correlate AI spend with git outcomes",
  description:
    "Open-source, self-hostable AI-engineering analytics. Auto-instruments every developer's coding-agent usage across IDEs and correlates LLM spend with Git outcomes — tenant-owned backend, works-council compatible by default.",
};

const ADAPTERS = [
  {
    name: "Claude Code",
    iface: "CLI",
    fidelity: "full",
    notes: "Tokens, envelopes, timings",
  },
  {
    name: "Cursor",
    iface: "IDE",
    fidelity: "full",
    notes: "Edits, diffs, model routing",
  },
  {
    name: "Codex CLI",
    iface: "CLI",
    fidelity: "full",
    notes: "JSONL tail, cumulative token diffs",
  },
  {
    name: "Continue.dev",
    iface: "IDE extension",
    fidelity: "full",
    notes: "Chat, tokens, edits, tool usage",
  },
  {
    name: "Cline / Roo / Kilo",
    iface: "IDE extension",
    fidelity: "full",
    notes: "3-in-1 adapter (fork lineage)",
  },
  {
    name: "Copilot IDE",
    iface: "IDE",
    fidelity: "estimated",
    notes: "Chat session JSON, Phase 2",
  },
  {
    name: "OpenCode",
    iface: "CLI",
    fidelity: "full",
    notes: "Post-migration SQLite",
  },
  {
    name: "Goose",
    iface: "Agent",
    fidelity: "estimated",
    notes: "Post-v1.10 SQLite, Phase 2",
  },
] as const;

const BILL = [
  "Prompts never leave the local environment without an explicit banner.",
  "Managers cannot read individual prompts except under three named, audited exceptions.",
  "Full 7-day GDPR export + erasure — atomic partition drop, not best-effort TTL.",
  "Default capture is counters plus redacted envelopes. Full prompt text is always opt-in.",
  "Every access event is logged to an append-only audit trail.",
  "ICs are notified via digest when a manager drills into their page.",
] as const;

const NOT = [
  "Per-engineer leaderboards or stack ranking.",
  "Bottom-10% lists or automated negative-performance flags.",
  "Performance-review or promotion-packet data surfaces.",
  "Real-time per-engineer activity feeds for managers.",
  "Cross-tenant benchmarking or external data sharing.",
  "A proxy that intercepts your LLM API keys.",
] as const;

export default function MarketingHome() {
  return (
    <>
      {/* ─── Hero ─────────────────────────────────────────────── */}
      <section className="mk-hero">
        <HeroGrid />
        <div className="mk-hero-content">
          <div className="mk-sys" style={{ marginBottom: 20 }}>
            SYS.INIT // v1.0.0 · Apache 2.0 + BSL 1.1
          </div>
          <h1>
            Correlate AI spend with <em>git outcomes</em>.
          </h1>
          <p>
            Auto-instrument LLM sessions across your team's IDEs — Claude Code,
            Cursor, Codex, Continue, Cline, Copilot, and more. Tenant-owned
            backend. Never our cloud unless you choose it.
          </p>
          <div className="mk-hero-actions">
            <a href="#install" className="mk-btn mk-btn-primary">
              Install
            </a>
            <a
              href="https://github.com/pella-labs/bematist"
              className="mk-btn mk-btn-ghost"
              rel="noreferrer"
            >
              View on GitHub
            </a>
            <Link href="/" className="mk-btn mk-btn-ghost">
              Open dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Brand monolith: ring + monogram ──────────────────── */}
      <BrandMonolith />

      {/* ─── Adapters ─────────────────────────────────────────── */}
      <section id="adapters">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs">01 / Adapters</span>
        </div>
        <table className="mk-table">
          <thead>
            <tr>
              <th>Target</th>
              <th>Interface</th>
              <th>Fidelity</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {ADAPTERS.map((row) => (
              <tr key={row.name}>
                <td style={{ color: "var(--mk-ink)" }}>{row.name}</td>
                <td className="mk-muted">{row.iface}</td>
                <td>
                  <span
                    className={`mk-badge ${row.fidelity === "full" ? "full" : "est"}`}
                  >
                    {row.fidelity === "full" ? "Full" : "Estimated"}
                  </span>
                </td>
                <td className="mk-muted">{row.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ─── Primary metric ───────────────────────────────────── */}
      <section className="mk-metric" aria-label="Primary metric">
        <div className="mk-metric-visual">
          <span className="mk-sys">PRIMARY METRIC</span>
          <div className="mk-metric-value">
            accepted_code_edits_per_dollar
          </div>
          <div className="mk-mono mk-xs mk-muted">
            Correlated via git history, webhook merges, and LLM telemetry.
            Dedup unit: (session_id, hunk_sha256).
          </div>
        </div>
        <div className="mk-metric-details">
          <span className="mk-sys">ATTRIBUTION LOGIC</span>
          <ul className="mk-kv">
            <li>
              <span>Event</span>
              <span>code_edit_tool.decision=accept</span>
            </li>
            <li>
              <span>Marker</span>
              <span>opt-in AI-Assisted: git trailer</span>
            </li>
            <li>
              <span>Validation</span>
              <span>GitHub merge webhook (HMAC)</span>
            </li>
            <li>
              <span>Compute</span>
              <span>Local aggregator · pricing_version pinned</span>
            </li>
            <li>
              <span>Revert penalty</span>
              <span>24h reverted hunks subtracted (v1)</span>
            </li>
          </ul>
        </div>
      </section>

      {/* ─── Privacy tiers ────────────────────────────────────── */}
      <section id="privacy">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs">02 / Privacy Tiers</span>
        </div>
        <div className="mk-tiers">
          <div className="mk-tier">
            <span className="mk-tier-label">TIER A · MINIMAL</span>
            <h3>Counters only</h3>
            <p>
              Token volumes, session durations, provider routing. No payload
              inspection. For highly-regulated orgs.
            </p>
          </div>
          <div className="mk-tier active">
            <span className="mk-tier-label">TIER B · DEFAULT</span>
            <h3>Redacted envelopes</h3>
            <p>
              All Tier A counters plus file-context paths and
              secret-redacted prompt structure. Works-council compatible.
              Matches Anthropic's <span className="mk-mono">OTEL_LOG_USER_PROMPTS=0</span>.
            </p>
          </div>
          <div className="mk-tier">
            <span className="mk-tier-label">TIER C · DIAGNOSTIC</span>
            <h3>Full prompt text</h3>
            <p>
              Opt-in per-project by the IC, or tenant-wide with signed Ed25519
              config, 7-day cooldown, and persistent IC banner.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Bill of rights vs not ────────────────────────────── */}
      <section className="mk-split">
        <div className="mk-split-col">
          <span className="mk-sys">DOC.01 // BILL OF RIGHTS</span>
          <ul className="mk-numbered">
            {BILL.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="mk-split-col right">
          <span className="mk-sys">DOC.02 // WHAT THIS IS NOT</span>
          <ul className="mk-numbered mk-not">
            {NOT.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── Install ──────────────────────────────────────────── */}
      <section id="install" className="mk-terminal-wrap">
        <span className="mk-sys" style={{ display: "block", marginBottom: 20 }}>
          SYS.DEPLOY // SELF-HOST FIRST
        </span>
        <div className="mk-terminal">
          <div className="mk-term-comment"># Pull tenant-owned backend</div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">
              curl -fsSL https://get.bematist.dev/compose.yml {">"}{" "}
              docker-compose.yml
            </span>
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">docker compose up -d</span>
          </div>
          <br />
          <div className="mk-term-comment"># Install the local collector</div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">brew install pella-labs/bematist/bematist</span>
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">bematist install --auto-detect</span>
          </div>
          <br />
          <div className="mk-term-comment"># Verify egress and open dashboard</div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">bematist doctor</span>
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">open http://localhost:9873</span>
          </div>
        </div>
      </section>

      {/* ─── License ──────────────────────────────────────────── */}
      <section className="mk-license">
        <span className="mk-sys">03 / LICENSE</span>
        <div className="mk-license-body">
          <strong>Apache-2.0</strong> — agent, dashboard, adapters, schemas,
          CLI.
          <br />
          <strong>BSL-1.1 → Apache-2.0 after 4 years</strong> — gateway, admin,
          SSO/SCIM, audit-log export, DP noise, compliance signing.
        </div>
      </section>
    </>
  );
}
