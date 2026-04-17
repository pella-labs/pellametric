import { z } from "zod";

/**
 * Privacy tier per D7. Default is **B** (counters + redacted envelopes).
 * Tier C is opt-in per-project for ICs, or tenant-wide via signed admin
 * config with a 7-day cooldown.
 */
export const Tier = z.enum(["A", "B", "C"]);
export type Tier = z.infer<typeof Tier>;

/**
 * IC-facing notification preference for "your sessions were viewed" digests.
 * Default is `daily` per D30; opt-out is permitted but transparency is the
 * default — never a premium feature.
 */
export const NotificationPref = z.enum(["immediate", "daily", "off"]);
export type NotificationPref = z.infer<typeof NotificationPref>;

export const EffectivePolicy = z.object({
  tenant_id: z.string(),
  /** The tier that will apply to new sessions under this policy. */
  tier: Tier,
  /** Retention in days. Partition-drop for Tier A (never TTL, per CLAUDE.md). */
  retention_days: z.number().int().positive(),
  redaction: z.object({
    trufflehog: z.boolean(),
    gitleaks: z.boolean(),
    presidio_ner: z.boolean(),
  }),
  /** Opt-in `AI-Assisted:` commit trailer (D29). */
  ai_assisted_trailer: z.boolean(),
  notifications: z.object({
    manager_view: NotificationPref,
  }),
  /** Cert-pinned egress allowlist. Compromised binary cannot exfiltrate elsewhere. */
  ingest_only_to: z.string().nullable(),
  /**
   * Presence of a signed Ed25519 config that flipped this tenant into Tier C
   * tenant-wide. Non-null → also carries the effective-from timestamp so the
   * dashboard can render the 7-day cooldown banner.
   */
  tier_c_signed_config: z
    .object({
      effective_at: z.string().datetime(),
      cooldown_ends_at: z.string().datetime(),
    })
    .nullable(),
  /**
   * Managed-cloud Tier-C requires explicit opt-in at the tenant level
   * (CLAUDE.md §API Rules). Read-only here; flipped by admin tooling.
   */
  tier_c_managed_cloud_optin: z.boolean(),
});
export type EffectivePolicy = z.infer<typeof EffectivePolicy>;

export const GetEffectivePolicyInput = z.object({});
export type GetEffectivePolicyInput = z.infer<typeof GetEffectivePolicyInput>;

export const GetEffectivePolicyOutput = EffectivePolicy;
export type GetEffectivePolicyOutput = z.infer<typeof GetEffectivePolicyOutput>;

// --- mutation: IC notification preference ---

export const SetNotificationPrefInput = z.object({
  manager_view: NotificationPref,
});
export type SetNotificationPrefInput = z.infer<typeof SetNotificationPrefInput>;

export const SetNotificationPrefOutput = z.object({
  manager_view: NotificationPref,
  /** Server-side timestamp the change landed; audit-logged upstream. */
  updated_at: z.string().datetime(),
});
export type SetNotificationPrefOutput = z.infer<typeof SetNotificationPrefOutput>;
