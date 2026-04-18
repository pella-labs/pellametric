// Collector config — env resolution.
//
// Per CLAUDE.md §Environment Variables, the canonical prefix is BEMATIST_*.
// Legacy DEVMETRICS_* names are honored as a fallback for older deploys /
// in-flight PRs; new code should write BEMATIST_*.

import { dataDir as defaultDataDir } from "@bematist/config";

export type Tier = "A" | "B" | "C";

export interface CollectorConfig {
  /** Ingest URL, default http://localhost:8000. */
  endpoint: string;
  /** Bearer token for the ingest key. REQUIRED for serve; dry-run may omit. */
  token: string;
  /** Cert-pinned ingest hostname (egress allowlist — CLAUDE.md §Security Rules). */
  ingestOnlyTo: string | null;
  /** Writable data dir (egress journal, SQLite state, per-adapter cursor files). */
  dataDir: string;
  /** Pino log level, default "warn" (quiet by default per CLAUDE.md). */
  logLevel: string;
  /** DRY_RUN=1 means log what would be sent, send nothing (Bill of Rights #1). */
  dryRun: boolean;
  /** Tenant identity (server overrides from JWT at ingest; collector sends for local audit). */
  tenantId: string;
  engineerId: string;
  deviceId: string;
  /** Default tier for events that don't specify one. Tier B per CLAUDE.md D7. */
  tier: Tier;
  /** Events per POST to /v1/events. Default 10 per the M4 brief; tunable. */
  batchSize: number;
  /** Milliseconds between orchestrator polls across all adapters. */
  pollIntervalMs: number;
  /** Milliseconds between flush attempts. */
  flushIntervalMs: number;
  /** Max concurrent adapter polls. */
  adapterConcurrency: number;
  /** Per-poll timeout to prevent a hung adapter from blocking others. */
  perPollTimeoutMs: number;
}

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v;
}

/**
 * Resolve from `BEMATIST_<NAME>` first, then legacy `DEVMETRICS_<NAME>`,
 * then fallback.
 */
function envBm(name: string, fallback?: string): string | undefined {
  return env(`BEMATIST_${name}`, env(`DEVMETRICS_${name}`, fallback));
}

function parseBool(v: string | undefined): boolean {
  if (!v) return false;
  const low = v.toLowerCase();
  return low === "1" || low === "true" || low === "yes";
}

function parseInt10(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseTier(v: string | undefined, fallback: Tier): Tier {
  if (v === "A" || v === "B" || v === "C") return v;
  return fallback;
}

export function loadConfig(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
  const endpoint = envBm("ENDPOINT") ?? envBm("INGEST_HOST") ?? "http://localhost:8000";
  const token = envBm("TOKEN") ?? "";
  const ingestOnlyTo = envBm("INGEST_ONLY_TO") ?? null;
  const dataDir = envBm("DATA_DIR") ?? defaultDataDir();
  const logLevel = envBm("LOG_LEVEL") ?? "warn";
  const dryRun = parseBool(envBm("DRY_RUN"));
  const tenantId = envBm("ORG") ?? "solo";
  const engineerId = envBm("ENGINEER") ?? "me";
  const deviceId = envBm("DEVICE") ?? "localhost";
  const tier = parseTier(envBm("TIER"), "B");
  const batchSize = parseInt10(envBm("BATCH_SIZE"), 10);
  const pollIntervalMs = parseInt10(envBm("POLL_INTERVAL_MS"), 5_000);
  const flushIntervalMs = parseInt10(envBm("FLUSH_INTERVAL_MS"), 1_000);
  const adapterConcurrency = parseInt10(envBm("CONCURRENCY"), 4);
  const perPollTimeoutMs = parseInt10(envBm("POLL_TIMEOUT_MS"), 30_000);

  return {
    endpoint,
    token,
    ingestOnlyTo,
    dataDir,
    logLevel,
    dryRun,
    tenantId,
    engineerId,
    deviceId,
    tier,
    batchSize,
    pollIntervalMs,
    flushIntervalMs,
    adapterConcurrency,
    perPollTimeoutMs,
    ...overrides,
  };
}

/** Collector version — surfaced by `bematist --version` / `status`. */
export const COLLECTOR_VERSION = "0.1.0";
