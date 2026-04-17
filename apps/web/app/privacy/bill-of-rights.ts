/**
 * Bematist Privacy Bill of Rights, version v1.
 *
 * Six items pinned to CLAUDE.md §Privacy Model Rules. Ownership of wording
 * sits with Workstream I (compliance — Sandesh); this module owns rendering.
 * When I lands polished copy, swap the `body` strings here — the version
 * string below MUST bump to v2 so external references can tell which wording
 * they're looking at.
 */

export interface BillOfRightsItem {
  id: string;
  title: string;
  body: string;
}

export const BILL_OF_RIGHTS_VERSION = "v1" as const;

export const BILL_OF_RIGHTS: readonly BillOfRightsItem[] = [
  {
    id: "banner-before-prompts",
    title: "Prompts never leave your machine without a banner",
    body: "If your organization enables full-prompt capture at any scope, your agent shows a persistent banner before the next prompt is sent. No silent upgrades.",
  },
  {
    id: "no-manager-prompt-read",
    title: "Managers cannot read your prompt text",
    body: "A manager sees your prompt text only under three named, audit-logged conditions: (1) you opt in at project scope, (2) an admin flips tenant-wide full-prompt mode with a signed config, a 7-day cooldown, and an in-app banner you acknowledge, or (3) an auditor with legal-hold opens a session. There is no fourth path.",
  },
  {
    id: "gdpr-export-erasure",
    title: "7-day export and erasure",
    body: "You can export or delete your data within 7 days of request. Erasure drops the underlying ClickHouse partition — your events leave the hot store, not just the dashboard.",
  },
  {
    id: "tier-b-default",
    title: "Counters and redacted envelopes by default",
    body: "Tier B (counters + server-redacted envelopes) is the default for every tenant. Tier A (counters only) is available for highly-regulated teams. Tier C (full prompt text) is explicit opt-in — never the default.",
  },
  {
    id: "every-access-logged",
    title: "Every access is logged",
    body: "Every query against your personal surfaces writes to an immutable audit log. You can request the log and see who looked, when, and why.",
  },
  {
    id: "notified-of-manager-views",
    title: "You are told when a manager looks",
    body: "When a manager opens your /me page, a session detail, or a reveal surface, a row lands in your daily digest. You can switch to immediate notifications, or opt out — but transparency is the default, never a paid feature.",
  },
] as const;
