// Feature flags (Sprint-1 Phase-4, PRD §Phase 4).
//
// Single place to read env into a typed Flags object. `assertFlagCoherence`
// guards combinations that would quietly break invariants — e.g. enabling the
// OTLP receiver without the WAL consumer running would silently drop telemetry.

export interface Flags {
  ENFORCE_TIER_A_ALLOWLIST: boolean;
  WAL_APPEND_ENABLED: boolean;
  WAL_CONSUMER_ENABLED: boolean;
  OTLP_RECEIVER_ENABLED: boolean;
  WEBHOOKS_ENABLED: boolean;
  CLICKHOUSE_WRITER: "client" | "sidecar";
}

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  const s = v.trim().toLowerCase();
  if (s === "1" || s === "true") return true;
  if (s === "0" || s === "false" || s === "") return false;
  return fallback;
}

export function parseFlags(env: Record<string, string | undefined>): Flags {
  const writer = env.CLICKHOUSE_WRITER === "sidecar" ? "sidecar" : "client";
  return {
    ENFORCE_TIER_A_ALLOWLIST: parseBool(env.ENFORCE_TIER_A_ALLOWLIST, false),
    WAL_APPEND_ENABLED: parseBool(env.WAL_APPEND_ENABLED, true),
    WAL_CONSUMER_ENABLED: parseBool(env.WAL_CONSUMER_ENABLED, true),
    // Phase 5 flips default on; Phase 6 webhooks default off until shipped.
    OTLP_RECEIVER_ENABLED: parseBool(env.OTLP_RECEIVER_ENABLED, false),
    WEBHOOKS_ENABLED: parseBool(env.WEBHOOKS_ENABLED, false),
    CLICKHOUSE_WRITER: writer,
  };
}

export class FlagIncoherentError extends Error {
  code = "FLAG_INCOHERENT" as const;
  details: string;
  constructor(details: string) {
    super(`FLAG_INCOHERENT: ${details}`);
    this.details = details;
  }
}

/**
 * Throws `FlagIncoherentError` if flag combinations are nonsensical. Called at
 * boot from `index.ts`; a throw causes `process.exit(2)` with a structured log.
 */
export function assertFlagCoherence(flags: Flags): void {
  if (flags.OTLP_RECEIVER_ENABLED && !flags.WAL_CONSUMER_ENABLED) {
    throw new FlagIncoherentError("OTLP_RECEIVER_ENABLED=1 requires WAL_CONSUMER_ENABLED=1");
  }
  if (flags.WAL_APPEND_ENABLED && !flags.WAL_CONSUMER_ENABLED) {
    // Appending without a consumer draining → WAL grows unboundedly.
    throw new FlagIncoherentError("WAL_APPEND_ENABLED=1 requires WAL_CONSUMER_ENABLED=1");
  }
  if (!flags.WAL_APPEND_ENABLED && flags.WAL_CONSUMER_ENABLED) {
    // L1 fix: consumer with no appender means the consumer drains an empty
    // stream forever — a waste of a redis connection and actively misleading
    // because /readyz.wal_consumer_lag will stay at 0 regardless of traffic.
    throw new FlagIncoherentError("WAL_CONSUMER_ENABLED=1 requires WAL_APPEND_ENABLED=1");
  }
}
