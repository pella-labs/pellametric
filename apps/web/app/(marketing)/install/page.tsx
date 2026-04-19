import type { Metadata } from "next";
import Link from "next/link";

const TITLE = "Install Bematist · Self-host the analytics platform for AI-assisted engineering";
const DESCRIPTION =
  "Stand up the backend with docker compose, drop the signed collector on every engineer's machine, and open the dashboard. Apache 2.0, runs offline, five minutes to first event.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/install" },
  openGraph: {
    type: "website",
    url: "/install",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    site: "@bematist_dev",
  },
};

const PREREQS = [
  {
    name: "Docker 24+ with compose",
    detail:
      "The self-host stack is three containers — Postgres, ClickHouse, Redis — behind the Bematist web and ingest services. One `compose up -d` is the whole backend.",
  },
  {
    name: "macOS, Linux, or Windows + WSL2",
    detail:
      "The collector is a single compiled binary. Native builds for darwin-arm64, darwin-x64, and linux-x64. Windows runs under WSL2 today.",
  },
  {
    name: "A hostname you control for ingest",
    detail:
      "The collector pins its TLS certificate to one hostname. A rogue binary cannot talk to anywhere else — the egress allowlist is enforced locally.",
  },
  {
    name: "GitHub CLI and cosign",
    detail:
      "Every release binary is Sigstore-signed with SLSA Level 3 build provenance. The preferred install path verifies the signature before the binary ever executes.",
  },
] as const;

type Mode = {
  label: string;
  title: string;
  body: string;
  command: string;
  who: string;
  active?: boolean;
};

const MODES: Mode[] = [
  {
    label: "Solo",
    title: "One engineer, one binary",
    body: "Single binary with an embedded database. Nothing phones home. Dashboard runs locally on port 9873. Good for a personal picture of your own usage.",
    command: "bematist serve --embedded",
    who: "Individuals, up to 5 engineers",
  },
  {
    label: "Team self-host",
    title: "Docker compose on your infra",
    body: "Full stack on your cluster: web, ingest, worker, Postgres, ClickHouse, Redis. Your hostname, your data, your retention policy, your egress rules.",
    command: "docker compose up -d",
    who: "5 to 500 engineers",
    active: true,
  },
  {
    label: "Managed",
    title: "We run it (coming)",
    body: "Hosted multi-tenant with SSO and SCIM. Tenant isolation at the database row level. Same binary on every engineer's machine — it just points at our endpoint instead of yours.",
    command: "BEMATIST_ENDPOINT=https://ingest.bematist.dev",
    who: "When you'd rather not run infra",
  },
];

type Adapter = {
  name: string;
  iface: "CLI" | "IDE";
  fidelity: string;
  capture: string;
};

const ADAPTERS_TODAY: Adapter[] = [
  {
    name: "Claude Code",
    iface: "CLI",
    fidelity: "Full",
    capture:
      "Sessions, input/output/cache tokens, model used, tools called, accepted edits. Native telemetry plus file-based backfill for sessions that predate the install.",
  },
  {
    name: "Codex CLI",
    iface: "CLI",
    fidelity: "Full",
    capture:
      "Sessions with per-turn token deltas, tool executions, and dollar cost. Cumulative counters are diffed so nothing double-counts.",
  },
  {
    name: "Cursor",
    iface: "IDE",
    fidelity: "Token-only",
    capture:
      "Generations, accept/reject, mode (auto vs manual), estimated cost. Auto-mode cost is labeled `estimated` instead of silently fabricated.",
  },
  {
    name: "Continue.dev",
    iface: "IDE",
    fidelity: "Full",
    capture:
      "Chat turns, token generation, edit outcomes, and tool usage — four streams, the richest native telemetry of any open IDE agent.",
  },
  {
    name: "OpenCode",
    iface: "CLI",
    fidelity: "Full",
    capture: "Sessions, tokens, model routing from OpenCode v1.2 onward.",
  },
  {
    name: "VS Code agent extensions",
    iface: "IDE",
    fidelity: "SDK",
    capture:
      "Twinny ships out of the box. The adapter SDK in the repo lets you add a new extension in a few hundred lines.",
  },
];

const ADAPTERS_ROADMAP: Adapter[] = [
  {
    name: "Goose",
    iface: "CLI",
    fidelity: "Roadmap",
    capture: "Sessions from Goose v1.10 onward.",
  },
  {
    name: "GitHub Copilot (IDE)",
    iface: "IDE",
    fidelity: "Roadmap",
    capture:
      "Per-prompt detail from VS Code workspace storage — the per-engineer view the Copilot Metrics API refuses to hand out.",
  },
  {
    name: "GitHub Copilot (CLI)",
    iface: "CLI",
    fidelity: "Roadmap",
    capture: "Sessions from the Copilot CLI's native telemetry logs.",
  },
  {
    name: "Cline / Roo / Kilo",
    iface: "IDE",
    fidelity: "Roadmap",
    capture: "One adapter for the whole fork family, from task files on disk.",
  },
];

type Tier = {
  label: string;
  title: string;
  body: string;
  retention: string;
  active?: boolean;
};

const TIERS: Tier[] = [
  {
    label: "Counts only",
    title: "Numbers leave, content does not",
    body: "Token counts, costs, model names, tool-call names. Prompt text never leaves the device. The right choice for regulated industries or engineers who want to opt down.",
    retention: "90 days",
  },
  {
    label: "Counts + patterns",
    title: "Summaries, not prompts",
    body: "Everything in Counts, plus short anonymized summaries of recurring workflows. Redaction and summarization happen on the engineer's machine before anything is sent. Team patterns surface only when at least three engineers share them.",
    retention: "90 days",
    active: true,
  },
  {
    label: "Full prompts",
    title: "Raw prompt text retained",
    body: "Full prompt text on the server for debugging and cluster analysis. Opt-in per project by the engineer, or opt-in tenant-wide by an admin with a cooldown and an in-app banner. Never the default.",
    retention: "30 days",
  },
];

const ENV_VARS = [
  {
    name: "BEMATIST_ENDPOINT",
    purpose:
      "The single switch between solo, self-host, and managed modes. Same binary everywhere.",
  },
  {
    name: "BEMATIST_TOKEN",
    purpose: "Bearer token for the ingest endpoint. Required for `serve`.",
  },
  {
    name: "BEMATIST_INGEST_ONLY_TO",
    purpose: "Hostname allowlist with certificate pinning. Blocks egress anywhere else.",
  },
  {
    name: "BEMATIST_DATA_DIR",
    purpose: "Where the egress journal and local state live. Defaults to ~/.bematist.",
  },
  {
    name: "BEMATIST_DRY_RUN",
    purpose: "Set to 1 to log what would be sent, without actually sending anything.",
  },
  {
    name: "BEMATIST_LOG_LEVEL",
    purpose: "Log verbosity. Defaults to `warn` so the daemon is quiet.",
  },
] as const;

const COMMANDS_TODAY = [
  { cmd: "bematist serve", body: "Run the collector daemon. Reads BEMATIST_* from your shell." },
  {
    cmd: "bematist status",
    body: "What's active, what was sent last, and which binary signature is running.",
  },
  {
    cmd: "bematist dry-run",
    body: "Poll once and log everything that would be sent. Sends nothing. Default on first install.",
  },
  {
    cmd: "bematist audit --tail",
    body: "Stream the egress journal — a timestamped record of every byte that left this machine.",
  },
  {
    cmd: "bematist doctor",
    body: "Pre-flight checks: ingest reachable, crash dumps disabled, adapters healthy, signature valid.",
  },
] as const;

const ROADMAP = [
  {
    title: "Policy file on disk",
    body: "Pick your privacy tier, redaction rules, and whether to tag commits with an `AI-Assisted:` trailer — all from a single config file that ships alongside the binary.",
  },
  {
    title: "Local-only reports",
    body: "`bematist outcomes`, `bematist waste`, `bematist prompts` — reports that run against your own session history and never leave the machine unless you explicitly share a playbook.",
  },
  {
    title: "GDPR tooling built in",
    body: "One command to purge a session from your local journal, one command to trigger server-side erasure on the backend. Seven-day SLA, audit-logged.",
  },
  {
    title: "Compliance exports",
    body: "Signed JSON export with SHA-256 manifest, mapped to SOC 2 and EU AI Act controls. For when procurement needs paperwork.",
  },
  {
    title: "Expanded adapter matrix",
    body: "Goose, GitHub Copilot (IDE + CLI), and the Cline / Roo / Kilo family — same session-files-on-disk approach, no API keys or proxies required.",
  },
  {
    title: "Managed cloud",
    body: "Same binary, our ingest. SSO and SCIM via WorkOS. Tenant isolation enforced at the database, not just the application layer.",
  },
] as const;

export default function InstallPage() {
  return (
    <>
      {/* Hero */}
      <section className="mk-hero" aria-labelledby="install-hero-title">
        <div
          className="mk-hero-grid"
          style={{ gridTemplateColumns: "minmax(0, 1fr)", textAlign: "center" }}
        >
          <div className="mk-hero-content" style={{ margin: "0 auto" }}>
            <div className="mk-sys" style={{ marginBottom: 20 }}>
              04 / install · apache 2.0 · self-hostable
            </div>
            <h1 id="install-hero-title">
              Five minutes to first <em>event</em>.
            </h1>
            <p>
              Start the backend with docker compose. Drop the signed collector on every engineer's
              machine. Open the dashboard. No API keys to proxy, no dev workflow to change, no data
              leaving your perimeter without a journal entry.
            </p>
            <div className="mk-hero-actions" style={{ justifyContent: "center" }}>
              <a
                href="#backend"
                className="mk-btn mk-btn-primary"
                aria-label="Jump to the self-host backend instructions"
              >
                Start with the backend
              </a>
              <a
                href="https://github.com/pella-labs/bematist/releases"
                className="mk-btn mk-btn-ghost"
                rel="noreferrer"
              >
                Signed releases
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Prerequisites */}
      <section aria-labelledby="prereqs">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs">01 / Before you begin</span>
        </div>
        <div className="mk-features">
          {PREREQS.map((p, i) => (
            <div key={p.name} className="mk-feature">
              <span className="mk-feature-index">0{i + 1}</span>
              <h3 style={{ fontSize: 18 }}>{p.name}</h3>
              <p>{p.detail}</p>
            </div>
          ))}
        </div>
        <p className="mk-license-body" style={{ padding: "24px" }} id="prereqs">
          Bematist never asks for your model API keys and never proxies model requests. It reads the
          session files that your agents already write to disk. If your engineers are running any of
          the agents below, the data is already on their machines — Bematist just makes it legible.
        </p>
      </section>

      {/* Pick a mode */}
      <section aria-labelledby="modes">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs">02 / Pick a mode</span>
        </div>
        <div className="mk-tiers">
          {MODES.map((m) => (
            <div key={m.label} className={`mk-tier${m.active ? " active" : ""}`}>
              <span className="mk-tier-label">{m.label}</span>
              <h3>{m.title}</h3>
              <p>{m.body}</p>
              <code
                className="mk-mono"
                style={{
                  fontSize: 12,
                  color: "var(--mk-accent)",
                  background: "var(--mk-bg-terminal)",
                  padding: "8px 10px",
                  borderRadius: 4,
                  border: "1px solid var(--mk-border)",
                  display: "block",
                  marginTop: "auto",
                }}
              >
                {m.command}
              </code>
              <span className="mk-mono" style={{ fontSize: 11, color: "var(--mk-ink-faint)" }}>
                {m.who}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Step 1 — backend */}
      <section className="mk-terminal-wrap" aria-labelledby="backend" id="backend">
        <span className="mk-sys" style={{ display: "block", marginBottom: 20 }} id="backend">
          03 / Self-host the backend
        </span>
        <div className="mk-terminal">
          <div className="mk-term-comment">
            # Postgres (control plane) · ClickHouse (events) · Redis (cache + idempotency)
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">
              curl -fsSL https://get.bematist.dev/compose.yml {">"} docker-compose.yml
            </span>
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">
              curl -fsSL https://get.bematist.dev/env.example {">"} .env
            </span>
          </div>
          <div className="mk-term-comment">
            # Fill in database passwords and your ingest hostname
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">docker compose up -d</span>
          </div>
          <br />
          <div className="mk-term-comment"># Migrate schemas (control plane + events store)</div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">
              docker compose run --rm worker bun run db:migrate:pg
            </span>
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">
              docker compose run --rm worker bun run db:migrate:ch
            </span>
          </div>
          <br />
          <div className="mk-term-comment"># Open the dashboard</div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">open http://localhost:3000</span>
          </div>
        </div>
      </section>

      {/* Step 2 — collector */}
      <section className="mk-terminal-wrap" aria-labelledby="collector">
        <span className="mk-sys" style={{ display: "block", marginBottom: 20 }} id="collector">
          04 / Install the collector
        </span>
        <div className="mk-terminal">
          <div className="mk-term-comment">
            # Preferred — signature-verified binary from GitHub releases
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">
              gh release download --repo pella-labs/bematist --pattern 'bematist-darwin-arm64'
            </span>
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">
              cosign verify-blob bematist-darwin-arm64 --certificate-identity-regexp
              'pella-labs/bematist' --certificate-oidc-issuer
              'https://token.actions.githubusercontent.com'
            </span>
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">
              sudo install bematist-darwin-arm64 /usr/local/bin/bematist
            </span>
          </div>
          <br />
          <div className="mk-term-comment">
            # Or use your package manager — same binary, same signature
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">brew install pella-labs/bematist/bematist</span>
            <span className="mk-term-comment">&nbsp;&nbsp;# macOS</span>
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">sudo apt install bematist</span>
            <span className="mk-term-comment">&nbsp;&nbsp;# Debian / Ubuntu</span>
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">yay -S bematist</span>
            <span className="mk-term-comment">&nbsp;&nbsp;# Arch / AUR</span>
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">choco install bematist</span>
            <span className="mk-term-comment">&nbsp;&nbsp;# Windows via WSL2</span>
          </div>
          <br />
          <div className="mk-term-comment">
            # One-liner fallback — wrapped for partial-pipe safety
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">curl -fsSL https://get.bematist.dev/install.sh | sh</span>
          </div>
        </div>
      </section>

      {/* Step 3 — configure */}
      <section aria-labelledby="configure">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs" id="configure">
            05 / Point the collector at your endpoint
          </span>
        </div>
        <table className="mk-table">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {ENV_VARS.map((e) => (
              <tr key={e.name}>
                <td style={{ color: "var(--mk-ink)", fontFamily: "var(--font-mk-mono)" }}>
                  {e.name}
                </td>
                <td className="mk-muted">{e.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mk-terminal-wrap">
          <div className="mk-terminal">
            <div className="mk-term-comment">
              # Typical self-host setup — three lines, one hostname
            </div>
            <div>
              <span className="mk-term-prompt">$</span>
              <span className="mk-term-cmd">
                export BEMATIST_ENDPOINT=https://ingest.yourteam.internal
              </span>
            </div>
            <div>
              <span className="mk-term-prompt">$</span>
              <span className="mk-term-cmd">
                export BEMATIST_INGEST_ONLY_TO=ingest.yourteam.internal
              </span>
            </div>
            <div>
              <span className="mk-term-prompt">$</span>
              <span className="mk-term-cmd">export BEMATIST_TOKEN=bm_org_key_****</span>
            </div>
          </div>
        </div>
      </section>

      {/* Step 4 — verify */}
      <section className="mk-terminal-wrap" aria-labelledby="verify">
        <span className="mk-sys" style={{ display: "block", marginBottom: 20 }} id="verify">
          06 / Dry-run first, verify, then serve
        </span>
        <div className="mk-terminal">
          <div className="mk-term-comment">
            # Logs what would be sent, sends nothing — safe to run on day one
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">bematist dry-run</span>
          </div>
          <br />
          <div className="mk-term-comment">
            # Pre-flight — ingest reachable, adapters healthy, binary signature valid
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">bematist doctor</span>
          </div>
          <br />
          <div className="mk-term-comment">
            # Stream the egress journal — every byte that left this machine
          </div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">bematist audit --tail</span>
          </div>
          <br />
          <div className="mk-term-comment"># When you're satisfied, run the daemon</div>
          <div>
            <span className="mk-term-prompt">$</span>
            <span className="mk-term-cmd">bematist serve</span>
          </div>
        </div>
      </section>

      {/* Step 5 — privacy */}
      <section aria-labelledby="privacy">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs" id="privacy">
            07 / Pick what leaves the machine
          </span>
        </div>
        <div className="mk-tiers">
          {TIERS.map((t) => (
            <div key={t.label} className={`mk-tier${t.active ? " active" : ""}`}>
              <span className="mk-tier-label">{t.label}</span>
              <h3>{t.title}</h3>
              <p>{t.body}</p>
              <span className="mk-mono" style={{ fontSize: 11, color: "var(--mk-ink-muted)" }}>
                Retention · {t.retention}
              </span>
            </div>
          ))}
        </div>
        <div className="mk-split">
          <div className="mk-split-col">
            <span className="mk-mono mk-xs">DEFAULTS WE SHIP</span>
            <ol className="mk-numbered">
              <li>
                The default setting sends counts and short anonymized summaries — not prompt text.
                Works-council compatible out of the box.
              </li>
              <li>
                Team-level tiles need at least five contributors. Prompt patterns need at least
                three. Below the threshold, the tile says so and renders nothing.
              </li>
              <li>
                Managers cannot read a specific engineer's prompt text. Every time a manager opens
                an engineer's page, that engineer is notified.
              </li>
              <li>
                One command purges a local session from your machine. One command triggers GDPR
                erasure on the backend, with a seven-day SLA.
              </li>
            </ol>
          </div>
          <div className="mk-split-col right">
            <span className="mk-mono mk-xs">THINGS WE WILL NOT SHIP</span>
            <ol className="mk-numbered mk-not">
              <li>Per-engineer leaderboards or bottom-10% lists.</li>
              <li>Performance-review reports or promotion packets.</li>
              <li>Real-time per-engineer event feeds.</li>
              <li>Cross-tenant benchmarking against other companies.</li>
              <li>Autonomous "AI coach" that nags engineers about their prompts.</li>
              <li>Proxying your model API keys — we observe, we don't gate.</li>
            </ol>
          </div>
        </div>
      </section>

      {/* Today */}
      <section aria-labelledby="today">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs" id="today">
            08 / Everything you get today
          </span>
        </div>

        <h3 className="mk-h3">Agents supported in v1</h3>
        <table className="mk-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Interface</th>
              <th>Fidelity</th>
              <th>What you get</th>
            </tr>
          </thead>
          <tbody>
            {ADAPTERS_TODAY.map((a) => (
              <tr key={a.name}>
                <td style={{ color: "var(--mk-ink)" }}>{a.name}</td>
                <td className="mk-muted">{a.iface}</td>
                <td>
                  <span className={`mk-badge ${a.fidelity === "Full" ? "full" : "est"}`}>
                    {a.fidelity}
                  </span>
                </td>
                <td className="mk-muted">{a.capture}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mk-h3">Collector commands</h3>
        <ul className="mk-kv">
          {COMMANDS_TODAY.map((c) => (
            <li key={c.cmd}>
              <span style={{ color: "var(--mk-ink)", fontFamily: "var(--font-mk-mono)" }}>
                {c.cmd}
              </span>
              <span className="mk-muted">{c.body}</span>
            </li>
          ))}
        </ul>

        <h3 className="mk-h3">Platform capabilities</h3>
        <ul className="mk-kv">
          <li>
            <span style={{ color: "var(--mk-ink)" }}>Self-host on your infra</span>
            <span className="mk-muted">
              Docker compose stack — Postgres, ClickHouse, Redis — behind Bematist's web and ingest.
            </span>
          </li>
          <li>
            <span style={{ color: "var(--mk-ink)" }}>Embedded single-binary mode</span>
            <span className="mk-muted">
              One process with an embedded database for individuals and teams of five or fewer.
            </span>
          </li>
          <li>
            <span style={{ color: "var(--mk-ink)" }}>Signed releases with provenance</span>
            <span className="mk-muted">
              Sigstore-signed binaries with SLSA Level 3 build attestation. Verify before you run.
            </span>
          </li>
          <li>
            <span style={{ color: "var(--mk-ink)" }}>Egress allowlist with cert pinning</span>
            <span className="mk-muted">
              Collector can only talk to the hostname you configure. Rogue builds cannot exfiltrate.
            </span>
          </li>
          <li>
            <span style={{ color: "var(--mk-ink)" }}>Local egress journal</span>
            <span className="mk-muted">
              Every byte that leaves the machine is logged on the machine. Tailed with `bematist
              audit`.
            </span>
          </li>
          <li>
            <span style={{ color: "var(--mk-ink)" }}>On-device redaction of prompt content</span>
            <span className="mk-muted">
              Secrets and PII are stripped before anything is sent. Full-prompt mode is opt-in,
              never default.
            </span>
          </li>
          <li>
            <span style={{ color: "var(--mk-ink)" }}>Dashboard with seven read surfaces</span>
            <span className="mk-muted">
              Summary, Sessions, Outcomes, Clusters, Insights, Teams, and a private `/me` view.
            </span>
          </li>
          <li>
            <span style={{ color: "var(--mk-ink)" }}>Outcome attribution to merged PRs</span>
            <span className="mk-muted">
              GitHub App joins accepted edits to merged commits. Revert-within-24h subtracts.
            </span>
          </li>
        </ul>

        <p className="mk-license-body" style={{ padding: "24px", marginTop: 24 }}>
          Adapters auto-detect on first run. If your engineers are on something exotic — a fork, a
          proprietary IDE, a shell harness — the adapter SDK in the repo lets you write a new
          handler in a few hundred lines of TypeScript.
        </p>
      </section>

      {/* Roadmap */}
      <section aria-labelledby="roadmap">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs" id="roadmap">
            09 / Roadmap
          </span>
        </div>

        <h3 className="mk-h3">Agents on the roadmap</h3>
        <table className="mk-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Interface</th>
              <th>Status</th>
              <th>What it will capture</th>
            </tr>
          </thead>
          <tbody>
            {ADAPTERS_ROADMAP.map((a) => (
              <tr key={a.name}>
                <td style={{ color: "var(--mk-ink)" }}>{a.name}</td>
                <td className="mk-muted">{a.iface}</td>
                <td>
                  <span className="mk-badge est">{a.fidelity}</span>
                </td>
                <td className="mk-muted">{a.capture}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mk-h3">Features on the roadmap</h3>
        <div className="mk-features">
          {ROADMAP.map((r, i) => (
            <div key={r.title} className="mk-feature">
              <span className="mk-feature-index">0{i + 1}</span>
              <h3 style={{ fontSize: 18 }}>{r.title}</h3>
              <p>{r.body}</p>
            </div>
          ))}
        </div>

        <p className="mk-license-body" style={{ padding: "24px", marginTop: 24 }}>
          These are named features on the roadmap, not shipping code. If one matters to your team,
          open an issue and we'll tell you honestly where it sits in the queue.
        </p>
      </section>

      {/* Troubleshooting */}
      <section aria-labelledby="troubleshooting">
        <div className="mk-section-header">
          <span className="mk-mono mk-xs" id="troubleshooting">
            10 / When something looks wrong
          </span>
        </div>
        <div className="mk-features">
          <div className="mk-feature">
            <span className="mk-feature-index">01</span>
            <h3 style={{ fontSize: 18 }}>Doctor reports crash dumps enabled</h3>
            <p>
              Bematist disables crash dumps on the collector process by design — they can contain
              whatever was in memory. If doctor complains, another hardening script on your system
              re-enabled them. Fix that first; we refuse to run otherwise.
            </p>
          </div>
          <div className="mk-feature">
            <span className="mk-feature-index">02</span>
            <h3 style={{ fontSize: 18 }}>Ingest is unreachable</h3>
            <p>
              Check BEMATIST_INGEST_ONLY_TO. If it's set to a hostname that doesn't resolve, the
              local egress allowlist will block everything. `bematist dry-run` prints the exact
              target and the response code it got.
            </p>
          </div>
          <div className="mk-feature">
            <span className="mk-feature-index">03</span>
            <h3 style={{ fontSize: 18 }}>Cursor sessions show "estimated" cost</h3>
            <p>
              That's correct, not a bug. Cursor's Auto-mode does not expose per-generation cost to
              any adapter — we label it rather than make a number up.
            </p>
          </div>
          <div className="mk-feature">
            <span className="mk-feature-index">04</span>
            <h3 style={{ fontSize: 18 }}>Old OpenCode sessions are missing</h3>
            <p>
              Sessions from before OpenCode v1.2 used a format we intentionally do not parse. They
              land in the orphan log with a warning rather than being silently misread.
            </p>
          </div>
          <div className="mk-feature">
            <span className="mk-feature-index">05</span>
            <h3 style={{ fontSize: 18 }}>Managed-cloud rejects prompt-text events</h3>
            <p>
              On managed cloud, the ingest server rejects full-prompt events unless the org admin
              has explicitly opted in. The client-side setting is not the security boundary — the
              server is.
            </p>
          </div>
          <div className="mk-feature">
            <span className="mk-feature-index">06</span>
            <h3 style={{ fontSize: 18 }}>Something still feels off</h3>
            <p>
              Open an issue with the output of `bematist doctor` and the last fifty lines of
              `bematist audit --tail`. Those two commands are the common ground for every support
              thread.
            </p>
          </div>
        </div>
      </section>

      {/* Closing */}
      <section className="mk-closing" aria-label="Next steps">
        <div className="mk-closing-inner">
          <p className="mk-closing-quote">The data was always yours. We just made it legible.</p>
          <p className="mk-closing-body">
            Apache 2.0 for the collector, dashboard, adapters, schemas, and CLI. The managed-cloud
            gateway is BSL 1.1 and converts to Apache 2.0 after four years.
          </p>
          <div className="mk-closing-actions">
            <Link href="/card" className="mk-btn mk-btn-primary">
              Grab your card
            </Link>
            <a
              href="https://github.com/pella-labs/bematist"
              className="mk-btn mk-btn-ghost"
              rel="noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
