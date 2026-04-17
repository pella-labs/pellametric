/**
 * Bill of Rights — canonical source of truth.
 *
 * Text is PRD §6.5 verbatim (locked). Do not paraphrase. Do not reorder.
 * Any amendment to the six items requires bumping `BILL_OF_RIGHTS_VERSION`
 * in lockstep with a matching update to `legal/review/bill-of-rights-rider.md`
 * and an amendment PR on `dev-docs/PRD.md` §6.5 itself.
 *
 * Downstream consumers that must import from this module:
 *   - `apps/web/app/privacy/page.tsx` (Sebastian / Workstream E) — renders the
 *     friendly list at `/privacy`.
 *   - `legal/review/bill-of-rights-rider.md` — the formal contract rider
 *     references these items by index and version.
 *
 * See `dev-docs/workstreams/i-compliance-prd.md` §6.1 for the two-artifact strategy
 * (friendly list here + formal rider in `legal/review/`).
 */

export const BILL_OF_RIGHTS_VERSION = "1.0.0" as const;

export const BILL_OF_RIGHTS: readonly string[] = [
  "Your prompts never leave your laptop unless you see a banner that says they will.",
  "Your manager cannot read your prompts. Until one of three named exceptions applies.",
  "You can see every byte stored about you and export or delete it (7-day GDPR SLA).",
  "The default is counters + redacted envelopes. Changing it requires a signed config + 7-day delay.",
  "Every access to your data is logged; you can request the log.",
  "You are notified every time a manager views your individual drill page.",
] as const;
