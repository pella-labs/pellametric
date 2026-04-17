# `legal/review/` — Compliance artifact drafts (pending counsel review)

**Owner:** Sandesh (Workstream I — Compliance)
**Status:** scaffold (Sprint 1 Day 1) — all files in this directory are DRAFTS
**Scope:** Sprint 1 → M3 PoC ship

> **Promotion flow.** Files in `legal/review/` are AI-drafted templates awaiting qualified-counsel review. Once a file passes jurisdictional counsel review (DE / FR / IT / EU) **and** a real works-council review (where applicable), it is promoted to `legal/templates/` in a follow-up PR that removes it from this directory. **Do not ship a file from this directory to a customer.** See `legal/templates/README.md` for the promotion criteria per file.

This directory holds drafts of the customer-facing compliance artifacts DevMetrics needs to sell into
EU mid-market and pass works-council review. Every file here has a corresponding regulatory
citation and a load-bearing place in the sales cycle. Scope, ship order, and per-file draft
sources are pinned in `dev-docs/workstreams/i-compliance-prd.md` §5.

Nothing in this directory is code. Rendering the Bill of Rights on `/privacy` is Sebastian's
(Workstream E / G-frontend) responsibility — he imports the canonical text from
`packages/config/src/bill-of-rights.ts`, which is the single source of truth.

## Artifact catalog (per i-compliance-prd §5)

| File | Purpose | Sales-cycle placement | Regulatory basis | Sprint |
|---|---|---|---|---|
| `README.md` (this file) | Index + usage guide | Internal reference | — | S1 |
| `works-agreement-DE.md` | Betriebsvereinbarung template for German works-council review | Pre-contract with any DE customer with a Betriebsrat | BetrVG §87(1) Nr. 6; §75 | S1 draft · S2 complete |
| `cse-consultation-FR.md` | CSE consultation deck / notice template | Pre-contract with any FR customer with a CSE | Code du travail Art. L1222-4, L2312-38 | S2 (pending OQ-1) |
| `union-agreement-IT.md` | Union-agreement template for remote-monitoring-capable systems | Pre-contract with any IT customer | Statuto dei Lavoratori Art. 4 | S2 (pending OQ-2) |
| `DPIA.md` | GDPR Art. 35 DPIA outline — customer DPO fills it | Attached to any EU customer's onboarding | GDPR Art. 35; ICO "Monitoring Workers" guidance | S1 outline · S2 complete |
| `SCCs-module-2.md` | SCCs 2021/914 Module 2 pre-fill + Transfer Impact Assessment (TIA) + DPF self-cert plan | Signed with any EU→US data-transfer customer on Day 1; superseded by EU-region Frankfurt at Phase 2 | GDPR Chapter V; Commission Decision 2021/914; DPF | S2 draft · S3 complete |
| `bill-of-rights-rider.md` | Formal contract rider mapping each of the six Bill of Rights items to statutory citation + product control + verification path | Included in enterprise MSA / DPA exhibits; load-bearing for works-council review | GDPR Art. 5, 13, 15, 17, 20, 25, 30; BetrVG §75, §87(1) Nr. 6; L2312-38; Art. 4 SdL | S1 draft · S2 legal-review-ready · S3 finalize |

## Bill of Rights — two-artifact strategy

1. **Friendly list** — rendered by Sebastian on `/privacy`, sourced from
   `packages/config/src/bill-of-rights.ts` (version-pinned). This is the warm,
   first-person-voice promise users see.
2. **Formal rider** — `bill-of-rights-rider.md` (in this directory). Third-person
   contract language, one paragraph per right, each paragraph citing the statute,
   naming the technical control, and describing the customer-verification path.

The two artifacts always carry the same six items in the same order. Version is
pinned in `packages/config/src/bill-of-rights.ts` via `BILL_OF_RIGHTS_VERSION`; the
rider must be bumped in lockstep whenever that version advances.

## Cross-references

- `dev-docs/workstreams/i-compliance-prd.md` — authoritative PRD for this workstream
- `dev-docs/PRD.md` §6.5 — the six Bill of Rights items, verbatim (locked)
- `dev-docs/PRD.md` §12 — full regulatory perimeter
- `CLAUDE.md` §"Compliance Rules", §"Privacy Model Rules", §"Security Rules"
- `packages/config/src/bill-of-rights.ts` — canonical Bill of Rights text + version
- `contracts/09-storage-schema.md` — `audit_events` and `audit_log` table locations
  (Bill of Rights items #5 and #6 reference these)

## Out of scope for Sprint 1 → M3

Deferred to later PRDs (per `i-compliance-prd.md` §2):

- SOC 2 Type I evidence plan → Phase 2 PRD
- SOC 2 Type II observation plan → Phase 3 PRD
- CAIQ v4.0.3 + SIG Lite 2024 pre-fills → Phase 3 PRD (Vendor Assessments)
- Customer-facing DPA template → Phase 2 PRD
- Sub-processor list → Phase 2 PRD
- Annual pen-test plan → Phase 3 PRD
