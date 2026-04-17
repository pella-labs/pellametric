# `legal/templates/` — Counsel-approved compliance artifacts

**Owner:** Sandesh (Workstream I — Compliance)
**Status:** promotion destination — currently empty
**Scope:** approved-for-customer-use templates only

This directory is the **promotion destination** for compliance artifacts after they pass qualified-counsel review.

## How files land here

Drafts are authored in `legal/review/`. Each draft carries a review checklist and a set of clauses flagged for counsel priority. A file is promoted from `legal/review/` to `legal/templates/` when **all** of the following are true:

1. Qualified employment-law counsel for the relevant jurisdiction (DE / FR / IT / EU) has reviewed every clause and signed off.
2. Where works-council / CSE / union agreement applies, one real works-council review (with a pilot customer) has confirmed the template passes co-determination sign-off without material modification.
3. All statutory citations have been verified against current text of the cited law.
4. Product controls cited (e.g., `devmetrics audit --tail`, `audit_log` append-only, Ed25519 signed tier change) have been cross-checked against the shipped code.
5. The file no longer carries a "TEMPLATE — requires counsel review" banner; instead a "counsel-reviewed on YYYY-MM-DD by {{COUNSEL_NAME}}" line is added.

Only then does the file move from `legal/review/X.md` to `legal/templates/X.md` in a promotion PR.

## Why we split drafts from approved templates

Simple safety. A customer-facing document that hasn't been reviewed by counsel can do real legal damage if it ships. Physically separating "drafts" (`legal/review/`) from "approved" (`legal/templates/`) makes it hard to confuse the two during sales / contract workflows.

## Cross-references

- `legal/review/` — current drafts
- `legal/review/README.md` — drafts index
- `dev-docs/workstreams/i-compliance-prd.md` — authoritative PRD for this workstream
