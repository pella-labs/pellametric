# Data Protection Impact Assessment — DevMetrics Deployment

**Template version:** 1.0.0-draft
**Statutory basis:** GDPR Art. 35 (Data Protection Impact Assessment); UK-GDPR Art. 35; ICO *Guidance on DPIAs*; CNIL *PIA methodology*; EDPB *Guidelines on DPIA* (WP248 rev.01).
**Maintained by:** DevMetrics Workstream I (Compliance).
**Not legal advice.** This is a processor-supplied *starting point* for the customer's Data Protection Officer. The customer is the **Controller** under GDPR Art. 4(7); DevMetrics operates as **Processor** under Art. 4(8) (or Joint Controller in limited managed-cloud features — see Appendix A). The customer DPO owns the final DPIA and any submission to a supervisory authority under Art. 36.

---

## Preamble — When this DPIA is required

A DPIA is **mandatory** for this deployment under GDPR Art. 35(3) because the processing meets two independently-triggering conditions:

1. **Art. 35(3)(a)** — systematic and extensive evaluation of personal aspects of natural persons based on automated processing, including profiling, on which decisions affecting those persons may be based. DevMetrics computes the **AI Leverage Score** (`ai_leverage_v1`), retry-pattern metrics, and maturity-ladder stages derived from engineering activity.
2. **Art. 35(3)(b)** — processing on a large scale. Day-one scale target: **10,000 developers / 8M events/day** per tenant.

**Further independent triggers likely to apply:**

- **EDPB Opinion 2/2017 on data processing at work** — any workplace technical system "suitable" to monitor employee performance triggers co-determination and a DPIA *regardless of the controller's intent*. Suitability, not intent, is the statutory test.
- **ICO *Monitoring Workers* guidance (Oct 2023)** — employer monitoring of workers requires a DPIA + worker notification.
- **EU AI Act (Reg. 2024/1689) Annex III(4)(b)** — employment-context scoring systems are high-risk; Phase 1 DevMetrics is designed to stay out via team-aggregate-only clustering, human-curated labels, and no automated worker decisions. If the customer deploys Phase 3 features (auto-coaching; per-session LLM judgment), fresh Art. 35 review is required.

**Expected output.** A customer-completed DPIA suitable for (i) records under Art. 30, (ii) works-council review where jurisdictionally required (DE / FR / IT — see Appendix B), and (iii) prior consultation with the supervisory authority under Art. 36 if, after mitigation, residual risk remains high.

**Review cadence.** Re-assess on any material change: privacy-tier default flip, new adapter, new sub-processor, cross-border transfer destination change, or metric version bump (`ai_leverage_v1` → `_v2`).

---

## Section 1 — Systematic description of processing operations (GDPR Art. 35(7)(a))

### 1.1 Nature, scope, context, purposes

| Dimension | Description |
|---|---|
| **Nature** | Passive endpoint-side capture of LLM / coding-agent telemetry (Claude Code, Codex, Cursor, OpenCode, Continue.dev, Cline/Roo/Kilo, and Phase-2 Goose + Copilot). Events are redacted, pseudonymized, transmitted to a tenant-scoped ingest server, materialized into time-series aggregates, and rendered in a manager dashboard. |
| **Scope** | `{{COUNT_ENGINEERS}}` engineers across `{{COUNT_REPOSITORIES}}` repositories. Deployment mode: ☐ Solo (≤ 5 devs) ☐ Team self-host ☐ Team managed cloud. |
| **Context** | Workplace monitoring context under EDPB Opinion 2/2017. Data subjects are **employees** (and, where applicable, contractors) of the Controller. Asymmetric power relationship means consent under Art. 6(1)(a) is generally **not** a valid lawful basis — see §2. |
| **Purposes** | (a) cost-attribution of LLM API spend; (b) reliability analytics on coding-agent workflows; (c) internal playbook sharing (§1.5 below). Performance evaluation is an **unlawful purpose** under this DPIA — see §2.3. |

### 1.2 Data categories by privacy tier

DevMetrics ships **Tier B** (counters + redacted envelopes) as the default (Decision D7). A tier change requires an Ed25519-signed tenant policy, a 7-day cooldown, and an in-IDE banner to every IC (Decision D20).

| Tier | What leaves the endpoint | Categories |
|---|---|---|
| **A — counters only** | Metrics + identifiers only | `session_id` (hashed), `engineer_id` (HMAC(SSO_subject, tenant_salt)), `team_id`, tool name, model, timestamps, tokens, cost, retry count, accept/reject outcome. |
| **B — counters + redacted envelopes** **(DEFAULT)** | Tier A + event-type metadata | As above + event type, hashed file path, error class, duration, prompt **length** (not text), diff line-count (not body), **redacted abstract** (Clio-adapted on-device pipeline — D27). |
| **C — full events + prompt text** | Tier B + raw content | As above + `user_prompt.prompt`, `tool_result.result`, file paths, diff bodies. **Managed cloud rejects Tier C with HTTP 403 unless `org.tier_c_managed_cloud_optin = true`.** |

### 1.3 Forbidden fields (server-rejected, all tiers)

The ingest endpoint rejects with HTTP 400 any payload containing: `rawPrompt`, `prompt_text`, `messages`, `toolArgs`, `toolOutputs`, `fileContents`, `diffs`, `filePaths`, `ticketIds`, `emails`, `realNames` — from Tier A or Tier B sources. This is enforced by an adversarial fuzzer in CI that must hit 100%. Rationale: defense-in-depth against collector misconfiguration.

### 1.4 Data flow

```
Developer endpoint  ──►  Tenant ingest  ──►  ClickHouse `events`
(collector +             (Bun server:           (partitioned by
 on-device Clio           server-side            (tenant_id,
 pipeline: redact         redact — TruffleHog    engineer_id, day))
 → abstract → verify      + Gitleaks + Presidio;          │
 → embed → PromptRecord)  Redis SETNX dedup,              ▼
                          7-day TTL)              Materialized views
                                 │                (dev_daily_rollup,
                                 ▼                 repo_weekly_rollup,
                          PostgreSQL control       prompt_cluster_mv)
                          plane (RLS on every              │
                          org-scoped table)                ▼
                                                  Manager dashboard
                                                  (k ≥ 5 cohort floor;
                                                   audit_events row on
                                                   every view — D30)
```

### 1.5 Secondary processing — playbook promotion (Decision D31)

Individual contributors may explicitly promote a workflow to a team-visible playbook. The flow surfaces the cluster label + the IC's own abstract + outcome metrics (IC can edit the abstract before confirming). Playbook content is **never** auto-promoted; takedown within 7 days is always permitted. Promotion constitutes a distinct processing purpose — document it in the customer's Art. 30 record.

### 1.6 Sub-processors

*Customer-specific; populated per deployment mode.* In **managed cloud**, probable sub-processors include: Anthropic (Insight-Engine LLM calls, redacted inputs only); OpenAI (default embedding provider — BYO key optional); embedding-model alternatives (Voyage, Ollama, Xenova — BYO); pricing-data source (LiteLLM pricing JSON); transit infrastructure (DNS, CDN). In **self-host**, DevMetrics is not a sub-processor of user data at all — the customer's own infrastructure is the processing environment. A full sub-processor list is a Phase-2 deliverable; link the customer's DPA sub-processor schedule here:

> **Controller action:** attach sub-processor schedule from executed DPA as Annex 1.

### 1.7 Retention

| Class | Retention | Mechanism |
|---|---|---|
| Tier C raw events | **30 days** | `DROP PARTITION` via partition-drop worker (D7). **TTL is NOT used for Tier A — that is a locked challenger-review fix (C1).** |
| Tier B raw events | 90 days | `DROP PARTITION` |
| Tier A raw events | 90 days | `DROP PARTITION` via partition-drop worker (never TTL) |
| Aggregates (rollups) | Indefinite | Pseudonymized via `HMAC(engineer_id, tenant_salt)` under GDPR Art. 17(3)(e) research/statistics carve-out |
| `audit_log`, `audit_events` | Indefinite | Append-only (REVOKE UPDATE, DELETE at DB level); required for Bill-of-Rights rider §5 + §6 |
| Erasure request record | 3 years post-completion | Art. 5(2) accountability |

**Erasure SLA: 7 days** — shorter than the Art. 12(3) maximum of one month. Triggered by `devmetrics erase --user <id> --org <id>`. Partition drop is atomic.

---

## Section 2 — Purposes, lawful basis, and legitimate-interests balancing (GDPR Art. 35(7)(a))

### 2.1 Lawful basis options under Art. 6(1)

| Basis | Applicability | Notes |
|---|---|---|
| **(b) Performance of a contract** | Applicable to engineers where employment contract or engagement contract explicitly provides for analytics processing | Narrow. Not a blanket basis for workplace monitoring. |
| **(c) Legal obligation** | Typically **not applicable** to DevMetrics outputs themselves; may apply to audit-log retention where sectoral regulation (SOX, HIPAA) compels it | Document the specific statute if relied upon. |
| **(f) Legitimate interests** | Most common basis; requires the three-part test below | Default basis; not available to public authorities acting in performance of public tasks. |

**Consent under Art. 6(1)(a) is not recommended.** EDPB Opinion 2/2017 §3.1: the asymmetric power relationship between employer and employee means consent is "highly unlikely to be freely given" and therefore usually invalid. Use (f) with a rigorous balancing test, not (a).

### 2.2 Legitimate-interests balancing worksheet (Art. 6(1)(f))

Customer DPO completes all three legs before relying on LI.

**Leg 1 — Purpose test.** State the interest: {{LEGITIMATE_INTEREST_STATEMENT}}. Confirm it is ☐ specific (not "general business efficiency"), ☐ real and present (not speculative), ☐ articulable to the employee.

**Leg 2 — Necessity test.** For each purpose, confirm no less-intrusive alternative achieves it:

| Purpose | Alternative considered | Why rejected |
|---|---|---|
| Cost attribution | Invoice-level spend only | Does not attribute to teams / projects — defeats purpose |
| Reliability analytics | Manual postmortems only | No continuous signal; retry-loop failures invisible |
| Playbook sharing | Ad-hoc documentation | Does not surface patterns that produced shipped code |

**Leg 3 — Balancing test.** Weigh interest against rights + reasonable expectations:

| Factor | Net |
|---|---|
| Employees' reasonable expectations (EDPB 2/2017) — LLM telemetry expected at vendor, not employer | Neutral-to-adverse |
| Tier B default = no prompt text leaves endpoint | Mitigated |
| Transparency: Bill of Rights + works-council agreement + IC notification (D30) | Mitigated |
| Chilling-effect risk scales with tier; Tier C materially affects behavior | Controller must not silently default to C |
| Less-intrusive alternatives (Leg 2) | Covered |

Conclusion: {{LI_BALANCING_CONCLUSION}} — e.g., "LI override holds at Tier B if the works-council agreement is in force and the Bill of Rights is published. Tier C requires per-IC opt-in at project scope; tenant-wide Tier C requires fresh balancing."

### 2.3 Explicit unlawful purposes

The following purposes are **excluded** by product design and customer contract. The Controller must **not** use DevMetrics outputs for these:

- **Performance evaluation of individual employees.** The AI Leverage Score is a team-aggregate diagnostic. Maturity-ladder stages are private to the IC (D8). Contract template language declares these outputs non-use for performance review.
- **Termination / promotion / compensation decisions.** DevMetrics outputs are not a permissible input under the DPIA's necessity test (Leg 2) — such decisions have traditional inputs (manager judgment, peer review, delivery outcomes) that do not require telemetry.
- **Public or intra-team rankings.** No "bottom-10%" lists. No public leaderboards. Product refuses to render these at any tier.
- **Real-time intervention or blocking.** Out of scope forever (CLAUDE.md §Non-goals).

If the Controller wishes to use DevMetrics outputs for any of the above, fresh lawful-basis analysis is required and the Bill of Rights rider is breached.

---

## Section 3 — Necessity and proportionality (GDPR Art. 35(7)(b))

### 3.1 Data minimization (Art. 5(1)(c))

Enforced structurally: **Tier B shipped default** (D7) — prompt text never leaves endpoint without an in-IDE banner; **forbidden-field server rejection** (§1.3) prevents collector-misconfig smuggling; **on-device Clio pipeline** (D27) redacts, abstracts via local LLM only (never cloud on raw prompt), verifies, embeds locally; **server-side redaction** (TruffleHog + Gitleaks + Presidio) runs on every event at ingest as defense-in-depth regardless of collector state.

### 3.2 Alternative rejected — Tier C as default

Documented rejection. Full-prompt-default was evaluated and rejected as disproportionate: fails Art. 5(1)(c) minimization, breaches works-council expectations in DE/FR/IT, creates chilling-effect risk unjustified by any purpose not already served by Tier B metrics.

### 3.3 Retention minimization (Art. 5(1)(e))

Partition-by-`(tenant_id, engineer_id, day)` (D15) enables atomic erasure; 7-day SLA (§1.7) significantly shorter than Art. 12(3)'s one-month maximum; indefinite aggregates pseudonymized at rollup with `HMAC(engineer_id, tenant_salt)` (sealed secret).

### 3.4 Purpose limitation — access matrix

Role-based access enforced via Postgres RLS on every org-scoped table. Cross-tenant probe (INT9) is a merge blocker; must return zero rows.

| Role | Tier A | Tier B (default) | Tier C |
|---|---|---|---|
| **IC (self)** | Own counters | Own counters + envelopes | Own + prompt text |
| **IC (peers)** | Team aggregate only | Team aggregate only | Team aggregate only |
| **Team Lead** | Team + per-IC counters | + per-IC hashed paths | + per-IC prompt text **only** if that IC opted in for that project |
| **Manager** | Team + org aggregate only | Same | Same — **no per-IC prompt text** without legal-hold |
| **Admin** | Config + audit-log only | Same | Same — **cannot read prompt text** (separation of duties) |
| **Auditor** | Audit-log only | Audit-log only | Audit-log only |

**Manager cannot read IC prompt text** except under three named, audit-logged exceptions: (1) IC opts in at project scope (revocable); (2) Admin flips tenant-wide full-prompt mode with signed Ed25519 config + 7-day cooldown + in-IDE banner to every IC (D20); (3) Legal-hold by Auditor role, time-boxed, named custodian.

### 3.5 Transparency to data subjects (Arts. 12–14)

**Bill of Rights** at `/privacy`, version-pinned (PRD §6.5); **IC notification of manager views** (D30) — every drill writes an `audit_events` row; IC gets daily digest by default, immediate-notification opt-in via `/me/notifications`, opt-out permitted but transparency is the default (never premium); **egress journal** via `devmetrics audit --tail`; **per-engineer export** via `devmetrics export` within 7 days.

---

## Section 4 — Risk assessment (GDPR Art. 35(7)(c))

Risks are rated on (likelihood × severity) on a 1–4 scale each. Impact classes follow CNIL PIA taxonomy: physical, material, moral.

| # | Risk | Likelihood (1–4) | Severity (1–4) | Impact class | Residual rating after mitigation |
|---|---|---|---|---|---|
| **R1** | Prompt-text leakage to manager view beyond the three named exceptions | 2 | 3 | Moral (chilling effect, employee trust) | Low |
| **R2** | Secret (API key, token) captured in prompt text and persisted | 3 | 4 | Material (secret exfiltration), moral (blame shift) | Low |
| **R3** | AI Leverage Score misused as a performance-review input | 3 | 4 | Moral (unfair treatment), material (career impact) | Low |
| **R4** | Cross-tenant data leakage via RLS bypass or query bug | 2 | 4 | Material (regulatory fines), moral (trust collapse) | Low |
| **R5** | Works-council rejects the deployment post-go-live in DE/FR/IT | 2 | 4 | Organizational (forced rollback; material labor-law fines) | Low (pre-deployment mitigation) |
| **R6** | EU→US international transfer challenged post-deployment | 3 | 3 | Legal (supervisory authority action) | Medium-Low |
| **R7** | 7-day erasure SLA missed → Art. 17 breach | 2 | 3 | Legal (Art. 83 fine exposure) | Low |
| **R8** | Re-identification of pseudonymized aggregates via auxiliary data | 2 | 3 | Moral | Low |
| **R9** | Tier-change flipped silently; ICs unaware their prompt text is now leaving endpoint | 1 | 4 | Moral (consent violation), legal | Low |
| **R10** | Endpoint binary compromised; exfiltrates to non-allowlisted host | 1 | 4 | Material | Low |

### R1 — Prompt-text leakage to manager

*Threat.* Manager reads IC prompt text absent IC opt-in or legal-hold.
*Mitigations.* Tier B shipped default (D7); prompt-text columns gated by explicit Reveal gesture + 2FA on CSV export; every Reveal fires an `audit_log` row (rider §5); `audit_events` row on every manager view (D30) with IC daily digest; CSV default redacts prompt columns; RLS + INT9 merge blocker.

### R2 — Secret-in-prompt capture

*Threat.* Developer pastes an API key or token into a prompt; secret is persisted.
*Mitigations.* On-device Clio pipeline (D27) — TruffleHog (800+ types) → Gitleaks → Presidio NER — before any byte leaves endpoint; **server-side authoritative** pass at ingest on `prompt_text`, `tool_input`, `tool_output`, `raw_attrs` (updateable without collector redeploy); privacy adversarial suite (`test:privacy`, INT10) merge-blocking at ≥ 98% recall on 100-secret corpus + nightly invariant scan for zero raw secrets in CH rows; Tier A `raw_attrs` write-time allowlist (C10).

### R3 — ALS misused for performance review

*Threat.* Manager / HR cites AI Leverage Score in a promotion packet, PIP, or termination.
*Mitigations.* Contract language (DPA template) declares outputs non-use for performance review; k ≥ 5 team-tile floor; maturity-ladder stage private to IC with explicit copy "never auto-assigned" (PRD §6.3); no public leaderboards / bottom-10% lists at any tier, any price (§6.4); score-display minimum-sample gate (≥ 10 sessions ∧ ≥ 5 active days ∧ ≥ 3 outcome events ∧ cohort ≥ 8); `works-agreement-DE.md` embeds verbatim *"nicht für Leistungs- und Verhaltenskontrollen"* clause.

### R4 — Cross-tenant leakage

*Threat.* Query / API / MV refresh returns rows from another tenant.
*Mitigations.* Postgres RLS on every org-scoped table; no `SET ROLE` bypass in app code; ClickHouse partitioning by `(tenant_id, engineer_id, day)` — tenant isolation at storage layer; tenant / engineer / device identity **server-derived from JWT**, never trusted from OTEL resource attrs (challenger threat #3); INT9 cross-tenant probe merge-blocking.

### R5 — Works-council rejection post-deployment

*Threat.* DE / FR / IT works-council discovers deployment and demands rollback (BetrVG §87(1) Nr. 6 / Art. L2312-38 / Statuto Art. 4).
*Mitigations.* Pre-deployment works-council agreement executed before first event (Appendix B); Tier B default + k ≥ 5 floor + no performance-review surfaces — defaults designed to pass review; marketing framed as "AI-spend and reliability analytics"; full-prompt labeled "monitoring mode — requires works-council sign-off in DE/FR/IT."

### R6 — EU → US transfer challenge

*Threat.* Supervisory authority determines transfer mechanism insufficient post-*Schrems II*.
*Mitigations.* **Day 1:** SCCs 2021/914 Module 2 + TIA + DPF self-cert (US recipient). **Phase 2:** Frankfurt EU region; zero-US-replication option. **Self-host:** no cross-border transfer — data stays on Controller infrastructure. See `legal/review/SCCs-module-2.md`.

### R7 — Erasure SLA miss

*Threat.* `devmetrics erase` not completed within 7 days; Art. 12(3) / 17 breach.
*Mitigations.* Atomic `DROP PARTITION` on `(tenant_id, engineer_id, day)`; tracker on `erasure_requests` table with `completed_at`; weekly batched mutation worker for aggregates (D8); INT12 GDPR end-to-end test in CI; automated email confirmation to IC.

### R8 — Re-identification of aggregates

*Threat.* Attacker with auxiliary data joins against `HMAC(engineer_id, tenant_salt)` aggregates.
*Mitigations.* Tenant salt is a sealed secret; no external service receives unsalted hashes; k-anonymity floor (k ≥ 5 team, k ≥ 3 cluster); Phase-2 on-device DP (OpenDP, ε = 1 per weekly release) additive on top of k.

### R9 — Silent tier flip

*Threat.* Admin changes tier B → C without IC awareness.
*Mitigations.* Ed25519-signed policy update (cryptographic); 7-day cooldown; in-IDE banner to every IC during cooldown (D20); `audit_events.tier_at_view` records tier at moment of view — enables post-flip audit.

### R10 — Compromised binary exfiltration

*Threat.* Tampered DevMetrics binary exfiltrates to attacker-controlled endpoint.
*Mitigations.* Sigstore + cosign signature per release; SHA-256 in release notes; SLSA L3 attestation; distro-package primary distribution (`curl | sh` is fallback); `DEVMETRICS_INGEST_ONLY_TO` cert-pinned egress allowlist; per-dev binary SHA256 in manager dashboard with alert on non-canonical; `ulimit -c 0` + `RLIMIT_CORE=0` (crash dumps disabled); `devmetrics doctor` verifies.

---

## Section 5 — Measures to address the risks (GDPR Art. 35(7)(d))

### 5.1 Technical measures

| # | Measure | Product control | CLAUDE.md §cross-ref | Enforces risks |
|---|---|---|---|---|
| T1 | Tier B default | `packages/config/devmetrics.policy.yaml` ships `tier: B`; managed cloud rejects tier=C with 403 unless opted in | §Security Rules; §6.1 | R1, R3, R5, R9 |
| T2 | On-device redaction + abstraction (Clio-adapted) | `packages/redact` client-side subset + local LLM abstraction before egress | §AI Rules (D27) | R1, R2 |
| T3 | Server-side redaction (authoritative) | `packages/redact`: TruffleHog + Gitleaks + Presidio at ingest | §Security Rules | R2 |
| T4 | Postgres RLS on every org-scoped table | Drizzle migrations; app cannot bypass without `SET ROLE`; INT9 merge blocker | §Database Rules | R4 |
| T5 | Partition-drop erasure (never TTL for Tier A) | Partition-drop worker (D7); `(tenant_id, engineer_id, day)` partitioning (D15); weekly batched mutation worker (D8) | §Database Rules; GDPR | R7 |
| T6 | `audit_log` append-only | `REVOKE UPDATE, DELETE` at DB level; IC-requestable via `devmetrics audit --my-accesses` | §Database Rules | R1, R3 |
| T7 | `audit_events` per-view row (D30) | One row per manager drill; IC daily digest; immediate-notification opt-in | §Security Rules; §Database Rules | R1, R3 |
| T8 | Ed25519-signed tier change + 7-day cooldown + IC banner | D20 signed config; cooldown worker; in-IDE banner | §Security Rules | R9 |
| T9 | Forbidden-field fuzzer (INT10) merge blocker | Server rejects 100% of payloads containing forbidden fields | §API Rules | R1, R2 |
| T10 | Cert-pinned egress allowlist | `DEVMETRICS_INGEST_ONLY_TO` | §Security Rules | R10 |
| T11 | Sigstore / cosign / SLSA L3 | Signed release; SHA-256 in release notes; per-dev binary SHA check | §Security Rules | R10 |
| T12 | SCCs Module 2 + TIA + DPF (Phase 1) / EU region (Phase 2) | `legal/review/SCCs-module-2.md`; Frankfurt endpoint | §Compliance Rules | R6 |
| T13 | k-anonymity floor (k ≥ 5 team tile; k ≥ 3 cluster; k ≥ 25 DP releases) | Storage-layer guard: below-threshold tile returns "insufficient cohort" | §Privacy Model Rules | R3, R8 |
| T14 | Minimum sample gates for score display | Storage-layer guard: ≥ 10 sessions ∧ ≥ 5 active days ∧ ≥ 3 outcome events ∧ cohort ≥ 8 | §Privacy Model Rules | R3 |
| T15 | Crash dumps disabled | `RLIMIT_CORE=0`; `devmetrics doctor` verifies | §Security Rules | R2 |

### 5.2 Organizational measures

| # | Measure | Owner | Artifact |
|---|---|---|---|
| O1 | Bill of Rights published at `/privacy`; version-pinned | Controller | `legal/review/bill-of-rights-rider.md`; `packages/config/src/bill-of-rights.ts` v1.0.0 |
| O2 | Works-council agreement executed before go-live (DE/FR/IT) | Controller | `works-agreement-DE.md`, `cse-consultation-FR.md`, `union-agreement-IT.md` |
| O3 | DPO appointed (Art. 37–39) and this DPIA signed off | Controller DPO | {{DPO_NAME}} |
| O4 | Employee notification before deployment (Art. 13) | Controller HR + DPO | Internal comms |
| O5 | Role training for Team Leads, Managers, Admins | Controller | "DevMetrics for Managers" 30-minute module |
| O6 | Data Processing Agreement (Art. 28) executed with DevMetrics | Controller + Processor | Phase-2 DPA template |
| O7 | Sub-processor notification + 30-day objection window | Processor → Controller | DPA §Sub-processors |
| O8 | Breach-notification runbook (Art. 33) | Controller + Processor | 72-hour SA notification path |
| O9 | Regular DPIA re-review on material change | Controller DPO | Trigger list in Preamble |
| O10 | Art. 36 prior consultation with supervisory authority if residual risk high | Controller DPO | See §6 |

### 5.3 Demonstrating compliance with Art. 5(2)

Controller retains: this completed DPIA + version history; executed DPA with DevMetrics; executed works-council / CSE / union agreement where jurisdictional; employee notification records; Art. 30 record of processing activities (separate document); sub-processor schedule (Annex 1 to DPA); SCCs Module 2 + TIA where cross-border; DPO sign-off (§6).

---

## Section 6 — Consultation and sign-off

### 6.1 Internal consultation (mandatory)

| Stakeholder | Consultation scope | Sign-off required | Date | Signature |
|---|---|---|---|---|
| Data Protection Officer | Entire DPIA | Yes | {{DATE}} | {{DPO_NAME}} |
| Information Security | §4 risks, §5.1 technical measures | Yes | {{DATE}} | {{CISO_NAME}} |
| Works council / CSE / union (DE / FR / IT) | §1–3, §5 | Yes where jurisdictional | {{DATE}} | {{WC_NAME}} |
| Legal counsel | §2 lawful basis, §5.2 organizational | Yes | {{DATE}} | {{COUNSEL_NAME}} |
| Head of Engineering / IC representative | §1.5, §3.4, §R3 mitigations | Recommended | {{DATE}} | {{ENG_NAME}} |

### 6.2 External consultation — Art. 36 prior consultation

Art. 36(1) requires consultation with the supervisory authority prior to processing where the DPIA indicates the processing would result in a **high residual risk** that the Controller cannot mitigate.

Trigger checklist — if **any** of these are true after §5 mitigation, the Controller submits to the supervisory authority under Art. 36:

- ☐ Residual rating of any R1–R10 remains High (not Low or Medium-Low).
- ☐ A works-council in DE / FR / IT has withheld consent and the Controller intends to proceed.
- ☐ The Controller plans to use DevMetrics outputs for any §2.3 unlawful purpose.
- ☐ The deployment involves special-category data under Art. 9 (unusual — investigate why).
- ☐ Managed-cloud Tier C is enabled at tenant level without per-project IC opt-in.

### 6.3 Customer pre-go-live checklist (the 7 items the DPO signs off on)

- ☐ **1.** Lawful basis for each processing purpose is documented in §2 (LI balancing complete or alternative basis cited).
- ☐ **2.** Tier is **B** in `devmetrics.policy.yaml` unless a Tier-C-specific LI balance is completed for the involved projects.
- ☐ **3.** Works-council / CSE / union agreement executed in DE / FR / IT where workforce is present.
- ☐ **4.** Employees notified of processing under Art. 13 at least {{NOTIFICATION_DAYS}} days before first event.
- ☐ **5.** Bill of Rights rider countersigned; `/privacy` page live at {{PRIVACY_URL}}.
- ☐ **6.** DPA executed; sub-processor schedule reviewed; SCCs Module 2 + TIA completed if cross-border.
- ☐ **7.** Erasure test performed end-to-end on a seeded test user; `devmetrics erase` returns confirmation within 7 days.

---

## Appendix A — DevMetrics Processor disclosures

Processor-supplied facts; Controller verifies against the executed DPA.

| Item | Value |
|---|---|
| **Controller identity** | {{CONTROLLER_LEGAL_NAME}}, {{CONTROLLER_ADDRESS}}, DPO: {{DPO_NAME}} ({{DPO_EMAIL}}) |
| **Processor identity** | DevMetrics — legal-entity details per executed DPA. For self-host deployments DevMetrics is **not** a processor of user data; support-access contacts only. |
| **Data subject categories** | Employees / contractors of the Controller who use DevMetrics-supported coding agents on work machines. |
| **Personal-data categories (Tier B default)** | Pseudonymized `engineer_id`, hashed `session_id`, redacted event envelopes with prompt length + diff line-count, hashed file paths, error class, timestamps, tokens, cost. |
| **Personal-data categories (Tier C opt-in)** | As Tier B + raw `user_prompt.prompt`, `tool_result.result`, file paths, diff bodies — **only within the three named exceptions (§3.4)**. |
| **Special categories (Art. 9)** | None by design. Secret scanners + forbidden-field rejection block accidental capture. If Art. 9 data is nonetheless captured, Controller initiates Art. 33 breach response. |
| **Recipients** | Internal: roles per §3.4 access matrix. External: only in managed-cloud mode — sub-processors per executed DPA. |
| **Third-country transfers** | **Self-host:** none (processing stays on Controller infrastructure). **Managed cloud (Phase 1):** SCCs 2021/914 Module 2 + TIA + DPF (US). **Managed cloud (Phase 2+):** Frankfurt EU region available. |
| **Retention** | Per §1.7. |
| **Technical measures** | Per §5.1; CLAUDE.md §Security Rules + §Database Rules + §Privacy Model Rules. |
| **Organizational measures** | Per §5.2; DPA + Bill of Rights rider + works-council templates. |
| **Controller rights under Art. 28(3)** | Audit rights, sub-processor approval, deletion / return of data at end of processing, assistance with data-subject requests (7-day erasure SLA). |
| **Processor obligations under Art. 28(3)** | Process only on Controller instructions; confidentiality; security (Art. 32); sub-processor engagement terms; assistance with Arts. 32–36. |

---

## Appendix B — Works-council jurisdictions

Where the Controller has workforce in DE / FR / IT, an additional statutory instrument is required **before** deployment. This DPIA alone does not satisfy those statutes.

| Jurisdiction | Statute | Instrument | Template |
|---|---|---|---|
| **Germany** | BetrVG §87(1) Nr. 6 — mandatory works-council co-determination on any technical system suitable to monitor employees (intent irrelevant per EDPB 2/2017) | Betriebsvereinbarung (works agreement) | `legal/review/works-agreement-DE.md` — embeds verbatim "nicht für Leistungs- und Verhaltenskontrollen" clause |
| **France** | Code du travail Art. L1222-4 (worker notification) + Art. L2312-38 (CSE consultation) | CSE consultation + individual notification | `legal/review/cse-consultation-FR.md` *(pending OQ-1 follow-up presearch per Workstream I PRD §11.1)* |
| **Italy** | Statuto dei Lavoratori Art. 4 — union agreement required for remote-monitoring-capable systems | Union agreement (accordo sindacale) or Labour Inspectorate authorization | `legal/review/union-agreement-IT.md` *(pending OQ-2 follow-up presearch per Workstream I PRD §11.1)* |

Where the workforce spans multiple EU jurisdictions, the Controller executes the appropriate instrument for each. Where non-EU workforce is present (UK, CH, NO), the Controller applies analogous local law (UK-GDPR + ICO *Monitoring Workers*; Swiss FADP; Norwegian Working Environment Act).

---

## Customer DPO review checklist

Short form — the 7 items the signing DPO should verify before countersigning the DPIA:

1. ☐ Every §2.1 lawful basis is documented (not "we'll figure it out").
2. ☐ Tier is B in `devmetrics.policy.yaml`; any Tier-C project is listed with its IC-opt-in evidence.
3. ☐ Works-council / CSE / union agreement executed where jurisdictional (Appendix B).
4. ☐ Employee notification under Art. 13 issued and logged.
5. ☐ Bill of Rights rider countersigned; `/privacy` live; v1.0.0 pinned.
6. ☐ Sub-processor schedule matches executed DPA; SCCs Module 2 + TIA where cross-border.
7. ☐ Erasure end-to-end test completed on seeded test user; 7-day SLA confirmed.

---

## Changelog

- **2026-04-16 — v1.0.0-draft.** Initial DPIA template, Workstream I (Sandesh). Structured per GDPR Art. 35(7)(a)–(d); six Art. 35(7) sections + two appendices + DPO checklist. Sourced from DevMetrics PRD §6 + §12, CLAUDE.md §Privacy Model Rules / §Security Rules / §Compliance Rules, and Workstream I PRD §5 DPIA row + §10.3 DPIA review gate. Review cadence: reassess on material change (privacy-tier default flip, new adapter, new sub-processor, cross-border destination change, metric version bump).

## Cross-references

- `dev-docs/PRD.md` §6 (Privacy & Access Model), §12 (Compliance) — source for tier defaults, role × tier matrix, Bill of Rights, retention, cross-border posture.
- `CLAUDE.md` §Privacy Model Rules, §Security Rules, §Database Rules, §API Rules, §Compliance Rules — source for technical measures per §5.1.
- `dev-docs/workstreams/i-compliance-prd.md` §5 (Artifacts catalog), §10.3 (DPIA review gate), §11 (Open questions).
- `legal/review/bill-of-rights-rider.md` — rider referenced by §5.2 O1 and §6.3 item 5.
- `legal/review/works-agreement-DE.md` — Appendix B.
- `legal/review/cse-consultation-FR.md` — Appendix B (pending OQ-1).
- `legal/review/union-agreement-IT.md` — Appendix B (pending OQ-2).
- `legal/review/SCCs-module-2.md` — §5.1 T12, Appendix A, §6.3 item 6.

**Not legal advice.** This document is a processor-supplied starting point. The customer's Data Protection Officer is responsible for validating, amending, and signing off on the final DPIA in light of the Controller's specific processing context.
