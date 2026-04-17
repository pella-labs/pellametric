# DevMetrics — Workstream I (Compliance) PRD

**Owner:** Sandesh
**Workstream:** I — Compliance & Legal (`legal/review/` + cross-workstream coordination)
**Status:** draft
**Last touched:** 2026-04-16
**Scope covers:** Sprint 1 → M3 PoC ship — works-council templates, DPIA outline, SCCs module 2 + DPF self-cert plan, Bill of Rights rider, `audit_events` schema coordination, CycloneDX SBOM coordination.
**Explicitly out of scope:** SOC 2 Type I evidence collection (Phase 2 PRD), SOC 2 Type II (Phase 3 PRD), CAIQ v4.0.3 + SIG Lite 2024 pre-fills (Phase 3 PRD), DPA template (Phase 2 PRD), sub-processor list (Phase 2 PRD), annual pen-test plan (Phase 3 PRD).

> This PRD is the implementation spec for one owner's compliance deliverables, bounded to the 4-week PoC window (Sprint 1 → M3). Longer-horizon compliance (SOC 2, vendor assessments) ships as separate PRDs when their phases begin — writing them now would be guessing at requirements that haven't stabilized.

## 1. Executive summary

DevMetrics cannot sell into EU mid-market without works-council-compatible artifacts. Under EDPB Opinion 2/2017 + BetrVG §87(1) Nr. 6 (Germany), Art. L1222-4 + L2312-38 (France), and Statuto dei Lavoratori Art. 4 (Italy), any system "suitable" to monitor employee performance triggers mandatory co-determination — *intent is irrelevant*. This workstream produces the legal templates, DPIA outline, cross-border transfer paperwork, and Bill of Rights rider that unblock first-EU-customer deals and pass works-council review. Parallel to templates, this workstream coordinates the `audit_events` table schema (transparency-of-manager-views, PRD D30) with Jorge and the CycloneDX SBOM release gate with Sebastian.

## 2. Scope

**In scope for Sprint 1 → M3:**

- `legal/review/` directory creation + per-file scope per §5.
- `packages/config/src/bill-of-rights.ts` — single source of truth for the 6-item Bill of Rights text + version field.
- `legal/review/bill-of-rights-rider.md` — formal contractual rider mapping each Bill of Rights item to statutory citation + product control.
- Cross-workstream coordination: `audit_events` schema with Jorge, SBOM CI gate with Sebastian, forbidden-field fuzzer roster with Walid.
- Open-question tracking for PRD §6.5 wording risks (W-1, W-2, W-3) — flagged here as amendment proposals to the master PRD, not edited here.

**Explicitly out of scope (deferred to later PRDs):**

- SOC 2 Type I evidence collection plan → Phase 2 PRD.
- SOC 2 Type II observation plan → Phase 3 PRD.
- CAIQ v4.0.3 + SIG Lite 2024 pre-fills → Phase 3 PRD (Vendor Assessments).
- Customer-facing DPA template → Phase 2 PRD.
- Sub-processor list (depends on managed-cloud sub-processors, not finalized) → Phase 2 PRD.
- Annual penetration test plan → Phase 3 PRD.
- Rendering the Bill of Rights on `/privacy` — that is Sebastian's workstream (E + G-frontend). We provide the canonical text import target; he renders.

**Workstream-boundary reminder:** we do not write code in `apps/web`, `apps/ingest`, `packages/schema`, or `packages/redact`. We propose schema additions through contract changelogs. We coordinate; we do not implement in other owners' files.

## 3. References (authoritative sources)

- `dev-docs/PRD.md` §6.5 — Bill of Rights (6 items, warm wording, locked).
- `dev-docs/PRD.md` §12 — Compliance regulatory perimeter + retention + cross-border posture.
- `dev-docs/PRD.md` §D1, §D7, §D8, §D18, §D20, §D30 — decisions referenced by compliance artifacts.
- `CLAUDE.md` §"Compliance Rules", §"Privacy Model Rules", §"Security Rules".
- `contracts/09-storage-schema.md` — `audit_events` + `audit_log` table locations (consumed for §9.1 schema proposal).
- Presearch findings (documented in PR landing this PRD) — Mozilla Privacy Principles, Cursor data-use, Anthropic Clio privacy center, EFF Bill of Rights precedent, German `Betriebsvereinbarung` templates (ver.di / betriebsrat-kanzlei / Haufe).

## 4. Regulatory perimeter

Retained verbatim from PRD §12 for this PRD's authors' and reviewers' convenience:

- **GDPR Art. 5, 6, 12, 13, 15, 17, 20, 25, 30, 35** — lawful basis, minimization, transparency, access, erasure (7-day SLA), data portability, privacy-by-default, records of processing, DPIA for systematic monitoring of employees.
- **UK-GDPR + ICO "Monitoring Workers" guidance (Oct 2023)** — DPIA + worker notification required.
- **CCPA / CPRA** — employee data in-scope since Jan 2023.
- **EU AI Act (Reg. 2024/1689) Annex III(4)(b)** — Phase 3 clustering triggers applicability; Phase 1 PoC stays out via team-aggregate-only clustering + human-curated labels + no automated worker decisions.
- **Germany — BetrVG §87(1) Nr. 6** — mandatory works-council co-determination on any technical system "suitable to monitor" employees.
- **France — Code du travail Art. L1222-4 + L2312-38** — worker-notification + CSE consultation.
- **Italy — Statuto dei Lavoratori Art. 4** — union agreement required for remote-monitoring-capable systems.
- **SOC 2 (AICPA TSP 100)** — Type I at Phase 2 M3; Type II at Phase 3 M9–M12. Out of scope for this PRD.

## 5. Artifacts catalog

Each file created in `legal/review/` during Sprint 1 → M3. Longer content in the implementation plan; scope below.

| File | Purpose | Load-bearing for | Draft source | Sprint |
|---|---|---|---|---|
| `legal/review/README.md` | Index + usage guide: which template goes where in the sales cycle | Internal reference | Author | S1 |
| `legal/review/works-agreement-DE.md` | Betriebsvereinbarung template per BetrVG §87(1) Nr. 6. Embeds verbatim clause *"nicht für Leistungs- und Verhaltenskontrollen"* (not for performance/behavior monitoring). Sections: scope/application, permitted use cases, employee rights, prohibition of performance control, data protection, qualification, conflict resolution | DE mid-market sales | ver.di guidance + betriebsrat-kanzlei + skill-sprinters sample | S1 draft · S2 complete |
| `legal/review/cse-consultation-FR.md` | CSE consultation deck per Art. L1222-4 + L2312-38 + L2312-8 4°. Structure mirrors **Groupe Alpha method agreement (15 Dec 2025)** three-phase cycle (Information / Expérimentation / Diagnostic) + parity technology commission + post-deploy anonymous questionnaire. Red-lines from **Metlife Europe (June 2025)**: no AI-only redundancy; AI excluded from pay/career HR decisions. **Pilot-phase-not-exempt clause** per **TJ Nanterre 29 Jan 2026** — POC/pilot phase also requires upfront CSE consultation | FR mid-market sales | Groupe Alpha + Metlife exemplars (OQ-1 presearch 2026-04-16); L1222-4 + L2312-38 verbatim from code.travail.gouv.fr | S2 draft · S3 complete |
| `legal/review/union-agreement-IT.md` | Accordo sindacale template per Statuto dei Lavoratori Art. 4 (2015 amended). Structure mirrors **GSK–ViiV Healthcare + RSU accordo (28 Jul 2025)** — bipartite osservatorio + anonymization + retention cap + explicit Art. 4 compliance. Hard constraint: **21-day metadata retention ceiling** per Garante Provv. 364/2024 (beyond 21d triggers Art. 4 c. 1 procedure — see CR-9). Warning clause: **strumento-di-lavoro comma-2 exception is a TRAP** per Cass. 28365/2025 — DevMetrics productivity capture falls under comma-1 monitoring | IT mid-market sales | GSK-ViiV exemplar + Garante Provv. 364/2024 + Cass. 28365/2025 (OQ-2 presearch 2026-04-16); Art. 4 verbatim from Brocardi/Normattiva | S2 draft · S3 complete |
| `legal/review/DPIA.md` | GDPR Art. 35 Data Protection Impact Assessment — outline template with headers + fill-in sections. Customers use as starting point for their own DPIA | Any EU customer | ICO + CNIL published DPIA templates | S1 outline · S2 complete |
| `legal/review/SCCs-module-2.md` | Commission SCCs 2021/914 Module 2 pre-fill for EU→US data transfer + Transfer Impact Assessment (TIA) + DPF self-cert plan (Phase-1 posture, Phase-2 EU-region Frankfurt migration plan) | Day 1 cross-border, Phase 2 EU region | EU Commission published text + DPF checklist | S2 draft · S3 complete |
| `legal/review/bill-of-rights-rider.md` | Formal rider for the 6-item Bill of Rights. One paragraph per item: restated in contract language, statutory citation, product control, verification path | Works-council agreements | PRD §6.5 + presearch patterns (Mozilla tone + Cursor specificity) | S1 draft · S2 legal-review-ready · S3 finalize |

## 6. Bill of Rights — two-artifact strategy

Research (presearch 2026-04-16) confirmed that no direct competitor publishes a numbered Bill of Rights. Mozilla's Data Privacy Principles is the closest tonal match; Cursor's data-use page is the closest specificity match; German `Betriebsvereinbarung` practice under §87(1) Nr. 6 BetrVG requires a formal parallel contract clause. Our ship strategy: **both, not either.**

### §6.1 Artifact 1 — the friendly list (Sebastian renders, we spec)

- **Wording:** PRD §6.5 verbatim. Never paraphrased. Version-pinned.
- **Single source of truth:** `packages/config/src/bill-of-rights.ts` exports:
  ```ts
  export const BILL_OF_RIGHTS_VERSION = "1.0.0" as const;
  export const BILL_OF_RIGHTS: readonly string[] = [
    "Your prompts never leave your laptop unless you see a banner that says they will.",
    "Your manager cannot read your prompts. Until one of three named exceptions applies.",
    "You can see every byte stored about you and export or delete it (7-day GDPR SLA).",
    "The default is counters + redacted envelopes. Changing it requires a signed config + 7-day delay.",
    "Every access to your data is logged; you can request the log.",
    "You are notified every time a manager views your individual drill page.",
  ] as const;
  ```
- **Rationale for this location:** `packages/config` is the shared config package already in the repo skeleton; both `apps/web` (Sebastian's `/privacy` render) and `legal/review/bill-of-rights-rider.md` (our rider) reference this same text.
- **Our obligation:** land the file in Sprint 1 Week 1. Mark version field `1.0.0`; bump on any PRD §6.5 amendment.
- **Sebastian's obligation (IW-4):** import from `packages/config/src/bill-of-rights.ts` in `/privacy` render. Do not duplicate the string literals.

### §6.2 Artifact 2 — the formal rider (we own fully)

`legal/review/bill-of-rights-rider.md`. One paragraph per item, four parts per paragraph:

1. **Restated in contract language.** Maps the warm promise to GDPR / BetrVG / L2312-38 / Art. 4 vocabulary. No "Your" first-person; formal third-person.
2. **Statutory citation.** Specific article number + jurisdiction.
3. **Product control.** The concrete technical mechanism that enforces the promise.
4. **Verification path.** How a customer's DPO or works-council counsel can verify the control actually works.

### §6.3 Mapping table — the 6 rider paragraphs

| # | PRD §6.5 item (friendly) | Rider paragraph statutory basis | Product control enforcing |
|---|---|---|---|
| 1 | Prompts never leave without banner | GDPR Art. 5(1)(c) data minimization + Art. 13 transparency | Tier-B default (counters + redacted envelopes); egress journal visible via `devmetrics audit --tail`; cert-pinned egress allowlist (`--ingest-only-to`) |
| 2 | Manager cannot read prompts | BetrVG §75 (equal treatment) + GDPR Art. 5(1)(b) purpose limitation; three exceptions match Statuto dei Lavoratori Art. 4 co-determined exceptions | RLS on `prompt_text` columns; `audit_log` row on every Reveal gesture; 2FA gate on CSV export-with-prompts |
| 3 | See / export / delete your data (7d SLA) | GDPR Art. 15 (access), 17 (erasure), 20 (portability), 12(3) (response within one month; we commit to 7 days) | `devmetrics erase`, `devmetrics export`, partition-drop worker (D15), 7-day SLA tracker on `erasure_requests` table |
| 4 | Default is counters + envelopes; change requires signed config + 7d delay | GDPR Art. 25 privacy-by-default + Art. 6 lawful basis (legitimate interests balancing) | Tier-B as shipped default (D7); Ed25519-signed `tier` policy change; 7-day cooldown worker; IC banner on IDE at flip time (D20) |
| 5 | Every access logged; can request log | GDPR Art. 30 (records of processing) + Art. 12(4) (information on requests) | `audit_log` append-only (REVOKE UPDATE, DELETE); IC-requestable via `devmetrics audit --my-accesses`; immutable retention indefinite |
| 6 | Notified when manager views your page | GDPR Art. 14 (info provided to data subject) + BetrVG §87(1) Nr. 6 transparency obligation; EDPB Opinion 2/2017 reinforces | `audit_events` table (D30); per-view row at view time; daily digest by default; immediate-notification opt-in via `/me/notifications` |

### §6.4 Wording pattern — per-paragraph template

```markdown
### Right [N] — [friendly promise restated as a right]

**Provision.** [Formal third-person statement. Example: "The Controller shall not
transmit employee prompt content from the employee's endpoint except where an
in-IDE notification banner has been displayed to the employee at the moment of
transmission."]

**Statutory basis.** [Article citation. Example: "GDPR Art. 5(1)(c) (data
minimization) and Art. 13(1)(c) (transparency of processing purposes).
BetrVG §87(1) Nr. 6 (co-determination on monitoring-capable systems)."]

**Product control.** [Concrete technical mechanism. Example: "Enforced by the
Tier-B shipped default (event envelopes are redacted server-side; raw prompt
text is neither captured nor persisted). Egress is journaled on the endpoint
and inspectable via the command `devmetrics audit --tail`."]

**Verification.** [DPO/counsel verification path. Example: "A customer's DPO
may audit compliance by (a) reading the `egress_journal_mirror` table for any
user; (b) running `devmetrics audit --verbose` on a representative endpoint;
(c) inspecting `packages/redact` server-side rules in the Apache 2.0 source."]
```

### §6.5 PRD §6.5 wording risks — flagged as amendment proposals

Research flagged three wording risks in the locked PRD §6.5 text that the compliance rider cannot fix unilaterally. These are proposals for the **master PRD**, not edits here.

| # | Risk | PRD §6.5 text | Proposed amendment for a future PRD revision |
|---|---|---|---|
| W-1 | Absolute "never" in item #1 overclaims vs Tier B redacted envelopes which DO leave | "Your prompts never leave your laptop unless you see a banner that says they will." | "Your **prompt text** never leaves your laptop unless an IDE banner tells you it will. **Redacted event envelopes and counters may leave** — `devmetrics audit --tail` shows every byte." |
| W-2 | Period-fragment in item #2 defers the three exceptions to a sub-page | "Your manager cannot read your prompts. Until one of three named exceptions applies." | "Your manager cannot read your prompt text, **except** in three named cases: (a) you opt in at project scope, (b) an admin flips tenant-wide full-prompt mode with a signed config + 7-day cooldown + in-IDE banner, (c) a legal-hold by an Auditor role. Every such read is audit-logged." |
| W-3 | Item #4 omits the Ed25519 + IC-banner detail that is load-bearing in D20 | "The default is counters + redacted envelopes. Changing it requires a signed config + 7-day delay." | "The default is counters + redacted envelopes. Changing it requires an **Ed25519-signed tenant policy, a 7-day cooldown, and an in-IDE banner to every IC before the switch takes effect.**" |

W-1 / W-2 / W-3 are recorded in §11 Open Questions for a follow-up PRD-amendment PR. The compliance rider uses the **current** §6.5 text (with the gaps) and phrases the rider to absorb them via the statutory + product-control paragraphs (e.g., the rider paragraph for item #1 explicitly states envelopes leave; the paragraph for item #4 explicitly names Ed25519 + banner). This way the rider is defensible even while §6.5 is mid-amendment.

## 7. Ship order (timeline)

| Day / Sprint | Deliverable |
|---|---|
| Sprint 1 Day 1 | Create `legal/review/` directory + `README.md` index. Create `packages/config/src/bill-of-rights.ts` with §6.5 verbatim + version `1.0.0`. Ping Sebastian (IW-4). |
| Sprint 1 Week 1 | Draft `works-agreement-DE.md` with verbatim Leistungs-und-Verhaltenskontrollen clause. Draft `bill-of-rights-rider.md` — all 6 paragraphs to first-pass. Draft `DPIA.md` outline. |
| Sprint 1 Week 2 | Propose `audit_events` schema to Jorge (§9.1). Confirm `audit_log` append-only invariant with Jorge (IW-2). Confirm forbidden-field roster with Walid (IW-5). |
| Sprint 2 | Complete `works-agreement-DE.md`. Kick off DE-counsel review (E-1, external). Draft `SCCs-module-2.md` + DPF checklist. Legal-review-pass on `bill-of-rights-rider.md`. Queue follow-up presearch for OQ-1 (FR) + OQ-2 (IT). |
| Sprint 3 | Finalize SCCs + DPF. Receive DE-counsel review comments; iterate `works-agreement-DE.md`. Partner with Sebastian on SBOM CI gate (IW-3). Land whichever FR/IT templates the presearch follow-up produced; escalate any that remain blocked. |

## 8. Cross-workstream coordination asks (IW-N)

| # | Ask | Owner | Sprint | Blocks |
|---|---|---|---|---|
| IW-1 | Confirm `audit_events` column schema (proposed in §9.1) | Jorge (D) | S1 Week 2 | M1 digest writes; Bill of Rights item #6 enforcement |
| IW-2 | Confirm `audit_log` append-only at DB level (`REVOKE UPDATE, DELETE`) | Jorge (D) | S1 Week 2 | Rider paragraph #5 citation; §10.4 forbidden-field cross-check |
| IW-3 | CycloneDX SBOM schema-validated in SLSA release workflow | Sebastian (F) | S3 | M3 release gate |
| IW-4 | `/privacy` page imports Bill of Rights from `packages/config/src/bill-of-rights.ts` | Sebastian (E) | S1 Week 1 | §6.5 single-source-of-truth integrity |
| IW-5 | Forbidden-field fuzzer roster matches compliance PRD enumeration (§10.5) | Walid (G-back) | S1 Week 2 | Adversarial gate consistency; rider paragraph #1 citation |
| **CW-5** | **Italian retention-ceiling product-posture decision** (per CR-9). Three options: (A) 21d default for IT tenants, (B) gate IT go-live on accordo sindacale signature, (C) customer-choice. Compliance recommendation: A+B combined | Sebastian (config defaults) + Jorge (storage schema) | S2 Week 1 | Unblocks IT sales motion; blocks `union-agreement-IT.md` final clause on retention |

Copy-paste ping messages for each owner are in §12 of this PRD.

## 9. Proposed `audit_events` schema (we spec, Jorge builds)

Per PRD D30 and `contracts/09-storage-schema.md` line 190. Proposal below; Jorge approves or amends in his D-workstream changelog.

### §9.1 Column list

```sql
CREATE TABLE audit_events (
  id                       uuid PRIMARY KEY,
  ts                       timestamptz NOT NULL,
  actor_user_id            text NOT NULL,           -- the manager who viewed
  actor_org_id             text NOT NULL,           -- tenant scope
  target_engineer_id_hash  text NOT NULL,           -- HMAC(engineer_id, tenant_salt)
  surface                  text NOT NULL,           -- e.g. '/team/:slug', '/me', '/sessions/:id', '/clusters/:id'
  session_id_hash          text,                    -- populated when viewing a specific session
  reveal_gesture           boolean DEFAULT false,   -- true if Reveal gesture fired (CSV export or prompt-text reveal)
  tier_at_view             text NOT NULL,           -- 'A' | 'B' | 'C' — what tier of content was visible
  user_agent_hash          text,
  ip_hash                  text                     -- HMAC'd; for legal-hold audit trail only
);

CREATE INDEX audit_events_target_ts
  ON audit_events (actor_org_id, target_engineer_id_hash, ts DESC);
```

### §9.2 Rationale — column ↔ Bill of Rights promise

| Column | Enforces |
|---|---|
| `actor_user_id` + `actor_org_id` | Rider paragraph #6 — IC knows *who* viewed them |
| `target_engineer_id_hash` | GDPR pseudonymization (HMAC per tenant, not cross-tenant joinable) |
| `surface` | Rider paragraph #6 — IC knows *what page* the manager viewed |
| `session_id_hash` | Rider paragraph #5 — drill-down tracking |
| `reveal_gesture` | Rider paragraph #2 — flags the three Reveal exceptions |
| `tier_at_view` | Rider paragraph #4 — proves tier at time of view (useful post-tier-flip audits) |
| Index `(actor_org_id, target_engineer_id_hash, ts DESC)` | Load-bearing for IC daily-digest query pattern ("what did managers see about me today?") |

### §9.3 RLS policy

Per CLAUDE.md §"Database Rules" universal RLS rule:

```sql
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Actor can see their own audit trail (rarely used)
CREATE POLICY actor_own ON audit_events
  FOR SELECT
  USING (actor_user_id = current_setting('app.current_user_id')::text
         AND actor_org_id = current_setting('app.current_org_id')::text);

-- Target engineer can see rows about themselves (Bill of Rights #5 + #6)
CREATE POLICY target_own ON audit_events
  FOR SELECT
  USING (target_engineer_id_hash = current_setting('app.current_engineer_id_hash')::text
         AND actor_org_id = current_setting('app.current_org_id')::text);

-- Auditor role (legal-hold) can see all within the org
CREATE POLICY auditor_role ON audit_events
  FOR SELECT
  TO auditor
  USING (actor_org_id = current_setting('app.current_org_id')::text);
```

Jorge owns final RLS wording; above is the proposal.

## 10. Review gates

Compliance work has non-code gates just as load-bearing as any CI check.

### §10.1 Legal review (external, queue early)

`works-agreement-DE.md` must be reviewed by DE-qualified employment-law counsel before any EU customer sees it. Counsel review timelines are typically 3–4 weeks; kicking off Sprint 1 Day 1 puts output back by late Sprint 3. **Engaging counsel is E-1 — see §12.**

### §10.2 Works-council review (pilot customer, Sprint 2+)

First DE customer go-live is blocked on one real works-council review. Not automatable. **Mitigation:** scout a pilot customer willing to do an early review (E-2 — see §12). Lessons learned roll back into the template.

### §10.3 DPIA review (customer-owned)

Customer's DPO signs their own DPIA; DevMetrics provides `legal/review/DPIA.md` as a starting template. Risk if our template has gaps → customer DPO red-lines back, slows sale. **Mitigation:** DPIA template reviewed against ICO + CNIL published examples during Sprint 2.

### §10.4 SBOM CI gate (automatable)

CycloneDX SBOM generated per release in Sebastian's SLSA L3 workflow. **Schema-validated in CI** (IW-3). Compliance PRD's requirement on Sebastian is:
- SBOM format: CycloneDX 1.5 JSON.
- Schema validation step before release publish.
- SBOM published alongside the signed release artifact.

### §10.5 Forbidden-field cross-check

CLAUDE.md §"API Rules" enumerates the forbidden fields server-side ingest MUST reject: `rawPrompt`, `prompt_text`, `messages`, `toolArgs`, `toolOutputs`, `fileContents`, `diffs`, `filePaths`, `ticketIds`, `emails`, `realNames`. Walid's adversarial fuzzer (G-back) is the enforcement mechanism. Compliance PRD cross-links to the fuzzer; **IW-5** asks Walid to confirm the roster matches exactly.

This gate backs rider paragraph #1 (prompts-never-leave) and #4 (tier default enforcement).

## 11. Open questions

Tracked so nothing falls on the floor.

### §11.1 Research gaps (status as of 2026-04-16 follow-up presearch)

- **OQ-1 — French CSE template. STATUS: RESOLVED (partial).** 2026-04-16 follow-up presearch found no published fully-downloadable template (CGT / CFDT publish checklists and position papers, not clause-by-clause templates; Dalloz/Lefebvre paywall gates existing law-firm templates). **Authoring structure unblocked:** mirror Groupe Alpha 15 Dec 2025 method agreement (Information / Expérimentation / Diagnostic three-phase cycle + parity technology commission); mirror Metlife Europe June 2025 for worker-protection red-lines; add pilot-phase-not-exempt clause per TJ Nanterre 29 Jan 2026 and France Télévisions TJ Paris 2 Sept 2025 (both closed the "it's only a POC" loophole). **Remaining gap:** Légifrance PDF fetches blocked (403) for Prisma Media accord ACCOTEXT000051467075 and Groupe Alpha full text — verbatim clauses still need direct retrieval. See CR-1 (downgraded from HIGH to MEDIUM).
- **OQ-2 — Italian Art. 4 Statuto dei Lavoratori template. STATUS: RESOLVED (partial).** 2026-04-16 follow-up presearch confirmed no national CGIL/CISL/UIL gold-standard template exists. **Authoring structure unblocked:** mirror GSK–ViiV Healthcare + RSU accordo of 28 Jul 2025 (bipartite osservatorio + anonymization + retention cap + explicit Art. 4 compliance); anchor purposes to Art. 4 c. 1; cite Garante Provv. 364/2024 21-day metadata ceiling (see CR-9); explicitly reject strumento-di-lavoro c. 2 exception per Cass. 28365/2025. **Remaining gap:** GSK-ViiV full accordo text not public (cited only by Lavorosi/Il Sole 24 Ore); Hanse BV PDF body still needs OCR pass; Regione Lombardia 30 May 2025 accordo PDF scanned-only. See CR-1.
- **OQ-3. Hanse Betriebsratsseminare sample BV PDF body text not extractable via WebFetch.** Still unresolved. **Action:** local PDF download + OCR pass before finalizing `works-agreement-DE.md` to capture verbatim best-practice clauses.

### §11.2 PRD §6.5 wording amendments (not this PRD's job, but flagged)

Three risks W-1, W-2, W-3 per §6.5 in this PRD. Proposal: a follow-up PR amends the master PRD §6.5 with the rewrites tabled there. The compliance rider ships today using the *current* §6.5 text and absorbs the gaps via statutory + product-control paragraphs.

### §11.3 Sub-processor list bootstrap

Managed-cloud sub-processors not finalized at PRD-writing time (Anthropic API, OpenAI embedding BYO, Voyage embedding BYO, LiteLLM pricing fetch, DNS, CDN, email). When the sub-processor list is authored (Phase 2 PRD), it gets cross-linked from the `bill-of-rights-rider.md` paragraph #1 verification path.

## 12. Ping messages for cross-workstream owners

Copy-paste-ready for the PR landing this PRD.

### §12.1 To Sebastian (F + E + G-frontend)

> Hey — landing H-scoring + I-compliance PRDs today. Three asks from compliance + scoring:
>
> 1. **`task_category` enum for the 2×2 manager view** (from H-scoring CW-1). I'm proposing `feature | bugfix | refactor | infra | docs | exploration` (fixed enum, not dynamic cluster labels — stable buckets across weeks). Does the 2×2 render stratified by this? Any category you'd add/drop?
> 2. **`packages/config/src/bill-of-rights.ts`** (IW-4) — I'm creating this as single source of truth for the 6-item Bill of Rights (PRD §6.5 text verbatim + version field). Please import from there when you build `/privacy` so the version-pinned promise stays honest.
> 3. **CycloneDX SBOM validation** (IW-3) — when you wire SBOM into the SLSA release workflow in Sprint 3, please schema-validate the output (CycloneDX 1.5 JSON). Compliance PRD treats that as the M3 release gate.

### §12.2 To Jorge (D + H-AI)

> Hey — H-scoring + I-compliance PRDs landing. Five asks, all small:
>
> 1. **`pricing_version_at_capture` stamped at write time** (H-scoring CW-2), not recomputed at score time. PRD D21 forbids silent recomputation, so this is the only timing that honors the rule. Confirm?
> 2. **Add `task_category LowCardinality(String)` column to `events` + both rollup MVs** (H-scoring R2 storage-side). Enum values pending Sebastian confirm: `feature | bugfix | refactor | infra | docs | exploration`. Required for 2×2 stratification.
> 3. **Column lists for `dev_daily_rollup` + `team_weekly_rollup`** (H-scoring CW-3, CW-4). Contract 09 names the MVs but doesn't enumerate columns. Can you add them as additive lines on `contracts/09` before Sprint 1 Day 5? I need them to write the scoring integration test.
> 4. **`audit_events` schema review** (I-compliance IW-1). Proposal in `dev-docs/workstreams/i-compliance-prd.md` §9.1 — columns, indexes, RLS policies. Please review/amend.
> 5. **`audit_log` append-only at the DB level** (I-compliance IW-2). Confirm `REVOKE UPDATE, DELETE` on the table, not just an app-layer policy. Rider paragraph #5 cites this as enforcement.

### §12.3 To Walid (C + G-back)

> Hey — compliance PRD cross-links to your ingest adversarial fuzzer as the enforcement mechanism for server-side forbidden-field rejection (IW-5).
>
> 1. **Forbidden-field roster consistency.** My compliance PRD enumerates: `rawPrompt`, `prompt_text`, `messages`, `toolArgs`, `toolOutputs`, `fileContents`, `diffs`, `filePaths`, `ticketIds`, `emails`, `realNames`. Please confirm the fuzzer's roster matches exactly — or ping back if you see fields to add/drop. The compliance PRD cites your fuzzer as the enforcement mechanism for Bill of Rights rider paragraphs #1 and #4.

### §12.4 External (non-PRD, Sandesh owns)

| # | Action | When | Risk if skipped |
|---|---|---|---|
| E-1 | Engage DE-qualified employment-law counsel for `works-agreement-DE.md` review | S1 Day 1 | CR-2: blocker on first DE customer; starts a 3–4 week counsel clock |
| E-2 | Scout a pilot DE customer willing to do an early works-council review (§10.2) | S2 | §10.2 — not automatable; first sale in DE waits otherwise |
| E-3 | ~~Queue follow-up presearch for FR (CGT templates) + IT (CGIL templates)~~ — **COMPLETED 2026-04-16.** Findings consolidated into §11.1 + §5 FR/IT rows + CR-1 + CR-9 + CR-10 | DONE | — |
| E-4 | Retrieve verbatim PDFs: Prisma Media ACCOTEXT000051467075, Groupe Alpha 15 Dec 2025 method agreement, GSK-ViiV 28 Jul 2025 accordo (all paywalled or 403'd during 2026-04-16 presearch) | S2 | CR-1 residual — verbatim clauses stronger than paraphrased secondary sources |

## 13. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| CR-1 | FR + IT template drafts not yet authored (OQ-1, OQ-2 presearch complete; structure identified; verbatim clause text still needed from 403-gated PDFs) → Sprint-2 authoring gap may delay first FR/IT customer | **MEDIUM** (downgraded from HIGH after 2026-04-16 presearch unblocked structure) | Author drafts in Sprint 2 using Groupe Alpha (FR) + GSK-ViiV (IT) exemplars; flag "synthesized, pending counsel review" in preamble; follow-up retrieval of Prisma Media + Groupe Alpha + GSK-ViiV verbatim PDFs queued |
| CR-2 | DE-counsel review latency → blocks DE customers | MEDIUM | Engage counsel S1 Day 1 (E-1); parallel work on rider + SCCs reduces critical path to ~3 weeks |
| CR-3 | PRD §6.5 wording risks W-1 / W-2 / W-3 unaddressed → enterprise legal red-line on friendly list | MEDIUM | Rider paragraphs absorb the gaps via statutory + product-control clauses; separate PRD-amendment PR scheduled |
| CR-4 | Hanse BV PDF body text not OCR'd → best-practice phrasing in `works-agreement-DE.md` may be suboptimal | LOW | Local OCR pass before S2 finalize |
| CR-5 | Jorge pushes back on `audit_events` schema → delays IC daily-digest UI → breaks rider paragraph #6 promise | LOW-MED | Schema proposal is minimal; Jorge is the authoritative owner and will shape final; escalate via contract-09 changelog |
| CR-6 | Sebastian forgets to import from `packages/config/src/bill-of-rights.ts` → `/privacy` text drifts from canonical → "version-pinned" promise broken | LOW | IW-4 ping + PR review on `apps/web/app/privacy/page.tsx` |
| CR-7 | Sub-processor list needed sooner than Phase 2 (e.g., customer asks during S3 sales call) | LOW | Stub in S3 as "current sub-processors: [Anthropic, OpenAI, DNS, CDN]"; full PRD in Phase 2 |
| CR-8 | Walid's fuzzer roster drifts from compliance PRD roster → forbidden-field rejection incomplete | LOW | IW-5 cross-check; single source of truth is CLAUDE.md §"API Rules"; both this PRD and Walid's fuzzer test cite it |
| **CR-9** | **Italian Garante Provv. 364/2024 caps metadata retention at 21 days. DevMetrics defaults (30d Tier-C, 90d Tier-B, 90d Tier-A) conflict for Italian tenants. Any raw-event retention beyond 21 days triggers Art. 4 c. 1 accordo sindacale requirement automatically.** Plus: Cass. 28365/2025 closed the strumento-di-lavoro c. 2 exception — DevMetrics productivity capture falls under c. 1 monitoring regardless of framing. Italian deployment cannot default-install without accordo sindacale or INL authorization | **HIGH** | **Escalate product-posture decision to Sebastian (config defaults) + Jorge (storage schema):** three options — (A) Italian tenants default to 21d raw retention (divergence from global defaults); (B) gate IT go-live on signed accordo sindacale regardless of retention length; (C) document as customer-choice with decision surfaced at deploy time. Recommendation: (A) + (B) combined (safest: 21d default AND accordo sindacale for any IT deployment). Not in compliance PRD's authority to decide — raise via new CW-5 ping to Sebastian/Jorge. Compliance artifact side: `union-agreement-IT.md` clause explicitly names the 21d ceiling + strumento-di-lavoro trap |
| **CR-10** | **TJ Nanterre 29 Jan 2026 + TJ Paris 02 Sept 2025 (France Télévisions) closed the "it's only a pilot / POC" loophole under L2312-8 + L2312-38.** DevMetrics dev-opt-in pilots in a French subsidiary still trigger full upfront CSE consultation before any bytes leave dev machines. FR sales cannot offer a "dev opt-in replaces CSE consultation" path | **MEDIUM-HIGH** | Authoring-side fix: `cse-consultation-FR.md` contains explicit "pilot-phase-is-in-scope" clause + Nanterre/France Télévisions citations; preamble warns that POC exemption is unavailable. Sales-motion fix (outside compliance PRD): any French sales playbook must be updated to NOT promise a POC-without-CSE path |

## 14. Acceptance criteria

### M1 (Sprint-1 end, ~Day 12)

- `legal/review/` directory created with `README.md` index landed.
- `packages/config/src/bill-of-rights.ts` with §6.5 verbatim text + `BILL_OF_RIGHTS_VERSION = "1.0.0"` shipped.
- Sebastian pinged and confirmed import target (IW-4).
- Drafts landed (not yet complete; polish in Sprint 2):
  - `works-agreement-DE.md` with the Leistungs-und-Verhaltenskontrollen clause embedded verbatim.
  - `DPIA.md` with all Art. 35(7) section headers populated.
  - `bill-of-rights-rider.md` with all 6 paragraphs first-drafted.
- Jorge pinged on IW-1 (`audit_events` schema) + IW-2 (`audit_log` append-only).
- Walid pinged on IW-5 (fuzzer roster).

### M2 (Sprint-2 end, ~Day 19)

- All 6 rider paragraphs complete with statutory citations + product-control mapping + verification path.
- `works-agreement-DE.md` complete and ready for counsel review.
- `SCCs-module-2.md` + DPF self-cert checklist first-drafted.
- `audit_events` schema (IW-1) confirmed and landed by Jorge.
- `audit_log` append-only (IW-2) confirmed by Jorge.
- Walid confirmed fuzzer roster (IW-5).
- DE-counsel review kicked off (E-1); expected output late Sprint 3.
- Follow-up presearch queued for OQ-1 (FR) + OQ-2 (IT); E-3 tracked.

### M3 (Sprint-3 end — PoC ship, ~Day 26)

- DE-counsel review complete **OR** blocker flagged with owner + unblock plan.
- `SCCs-module-2.md` + DPF checklist finalized.
- CycloneDX SBOM CI gate (IW-3) green in Sebastian's release workflow.
- FR + IT templates either drafted from follow-up presearch (E-3 succeeded) **OR** OQ-1 / OQ-2 escalated with named follow-up PRD.
- `/privacy` page renders Bill of Rights from `packages/config/src/bill-of-rights.ts` — confirmed by inspecting Sebastian's `apps/web/app/privacy/page.tsx`.

## 15. Changelog

- 2026-04-16 — initial draft PRD landed alongside ping-list for Sebastian / Jorge / Walid and external actions E-1, E-2, E-3.
- 2026-04-16 (amendment 1) — fold 2026-04-16 follow-up presearch findings: §5 FR/IT rows now reference concrete exemplars (Groupe Alpha, GSK-ViiV, Metlife); §11.1 OQ-1 + OQ-2 marked RESOLVED (partial — verbatim PDFs still gated); CR-1 downgraded HIGH → MEDIUM; **new CR-9** (Italy Garante Provv. 364/2024 21-day metadata retention ceiling conflicts with DevMetrics defaults); **new CR-10** (French TJ Nanterre 29 Jan 2026 + France Télévisions TJ Paris 02 Sept 2025 close the pilot/POC loophole); E-3 marked DONE; **new E-4** (retrieve 403-gated verbatim PDFs); **new CW-5** (Italian retention-ceiling product-posture decision to Sebastian + Jorge).
