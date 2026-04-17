// Tier enforcement (Sprint-1 Phase-2, PRD §Phase 2, D-S1-31).
//
// Runs between auth and zod/dedup in apps/ingest/src/server.ts. Three sub-stages:
//
//   1. Org-policy load (60s cache) — missing row → 500 ORG_POLICY_MISSING.
//   2. Forbidden-field scan (pre-zod) — Tier A/B events with any of
//      packages/schema FORBIDDEN_FIELDS → 400 FORBIDDEN_FIELD.
//   3. Tier-C opt-in gate — Tier-C events when
//      org.tier_c_managed_cloud_optin=false → 403 TIER_C_NOT_OPTED_IN.
//
// The Tier-A raw_attrs allowlist (contract 08 §Tier A allowlist) is a SEPARATE
// post-zod stage `applyTierAAllowlist`, gated by ENFORCE_TIER_A_ALLOWLIST env
// flag. Sprint-1 default: off (no-op path).
//
// See CLAUDE.md §API Rules ("Managed-cloud Tier-C 403 guard"), §Security Rules,
// contract 08 §Forbidden-field rejection.

import { filterRawAttrs } from "@bematist/redact";
import { containsForbiddenField } from "@bematist/schema";

export type Tier = "A" | "B" | "C";

export interface OrgPolicy {
  tier_c_managed_cloud_optin: boolean;
  tier_default: Tier;
  /** Per-org additions to the Tier-A raw_attrs allowlist (contract 08 §F). */
  raw_attrs_allowlist_extra?: string[];
  /**
   * Per-source webhook shared secrets (Phase 6). Map of source→secret. Used
   * by the verifier in apps/ingest/src/webhooks/router.ts. Absent / missing
   * entry → 401 on that webhook path.
   */
  webhook_secrets?: Partial<Record<"github" | "gitlab" | "bitbucket", string>>;
  /**
   * Optional source-IP allowlist applied by the GitLab plaintext verifier.
   * Empty / undefined → skip IP check (dev mode).
   */
  webhook_source_ip_allowlist?: string[];
}

export interface OrgPolicyStore {
  get(orgId: string): Promise<OrgPolicy | null>;
}

export type TierEnforceResult =
  | { reject: true; status: 400 | 403 | 500; code: string; field?: string }
  | { reject: false };

function pickTier(rawEvent: unknown, fallback: Tier): Tier {
  if (rawEvent && typeof rawEvent === "object") {
    const t = (rawEvent as { tier?: unknown }).tier;
    if (t === "A" || t === "B" || t === "C") return t;
  }
  return fallback;
}

/**
 * Pre-zod tier enforcement. Runs on the RAW request payload (unknown).
 *
 * - `orgPolicy === null` → 500 ORG_POLICY_MISSING.
 * - Effective tier = `rawEvent.tier` if valid, else `auth.tier`.
 * - Tier A or B → `containsForbiddenField(rawEvent)`; hit → 400 FORBIDDEN_FIELD.
 * - Tier C and NOT opted in → 403 TIER_C_NOT_OPTED_IN.
 * - Otherwise → {reject: false}.
 */
export async function enforceTier(
  rawEvent: unknown,
  auth: { tier: Tier; tenantId: string },
  orgPolicy: OrgPolicy | null,
): Promise<TierEnforceResult> {
  if (orgPolicy === null) {
    return { reject: true, status: 500, code: "ORG_POLICY_MISSING" };
  }

  const effectiveTier = pickTier(rawEvent, auth.tier);

  if (effectiveTier === "A" || effectiveTier === "B") {
    const field = containsForbiddenField(rawEvent);
    if (field !== null) {
      return { reject: true, status: 400, code: "FORBIDDEN_FIELD", field };
    }
  }

  if (effectiveTier === "C" && !orgPolicy.tier_c_managed_cloud_optin) {
    return { reject: true, status: 403, code: "TIER_C_NOT_OPTED_IN" };
  }

  return { reject: false };
}

// -------------------- POST-zod Tier-A allowlist (sub-stage 3) --------------

export interface TierAAllowlistResult {
  /** Event with `raw_attrs` filtered to allowlist when feature flag on. */
  event: { tier: Tier; raw_attrs?: Record<string, unknown>; [k: string]: unknown };
  dropped_count: number;
  dropped_keys: string[];
  raw_attrs_filtered: boolean;
}

/**
 * Apply the Tier-A raw_attrs allowlist post-zod.
 *
 * Gated by `enabled` (typically `process.env.ENFORCE_TIER_A_ALLOWLIST === "1"`).
 * When disabled this is a no-op so Sprint-1 default behavior is unchanged.
 * When enabled AND `event.tier === "A"`, `raw_attrs` is filtered via
 * `filterRawAttrs(attrs, orgPolicy.raw_attrs_allowlist_extra)`.
 */
export function applyTierAAllowlist(
  event: { tier: Tier; raw_attrs?: Record<string, unknown>; [k: string]: unknown },
  orgPolicy: OrgPolicy,
  enabled: boolean,
): TierAAllowlistResult {
  if (!enabled || event.tier !== "A" || event.raw_attrs === undefined) {
    return {
      event,
      dropped_count: 0,
      dropped_keys: [],
      raw_attrs_filtered: false,
    };
  }
  const { filtered, dropped_keys } = filterRawAttrs(
    event.raw_attrs,
    orgPolicy.raw_attrs_allowlist_extra ?? [],
  );
  const nextEvent: { tier: Tier; raw_attrs?: Record<string, unknown>; [k: string]: unknown } = {
    ...event,
  };
  if (filtered !== undefined) {
    nextEvent.raw_attrs = filtered;
  } else {
    delete nextEvent.raw_attrs;
  }
  return {
    event: nextEvent,
    dropped_count: dropped_keys.length,
    dropped_keys,
    raw_attrs_filtered: dropped_keys.length > 0,
  };
}

// -------------------- In-memory policy store --------------------

interface CacheEntry {
  value: OrgPolicy | null;
  expiresAt: number;
}

/**
 * In-memory OrgPolicyStore for dev and tests. 60s TTL cache by default.
 * Production swaps for a Postgres-backed impl reading from `policies` table.
 */
export class InMemoryOrgPolicyStore implements OrgPolicyStore {
  private readonly rows = new Map<string, OrgPolicy>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(opts: { ttlMs?: number; clock?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? 60_000;
    this.clock = opts.clock ?? (() => Date.now());
  }

  seed(orgId: string, policy: OrgPolicy): void {
    this.rows.set(orgId, policy);
    this.cache.delete(orgId); // invalidate on write
  }

  clear(): void {
    this.rows.clear();
    this.cache.clear();
  }

  async get(orgId: string): Promise<OrgPolicy | null> {
    const now = this.clock();
    const cached = this.cache.get(orgId);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    const value = this.rows.get(orgId) ?? null;
    this.cache.set(orgId, { value, expiresAt: now + this.ttlMs });
    return value;
  }
}
