// Collector config — env + ~/.bematist/config.env resolution.
//
// Per CLAUDE.md §Environment Variables, the canonical prefix is BEMATIST_*.
// Legacy DEVMETRICS_* names are honored as a fallback for older deploys /
// in-flight PRs; new code should write BEMATIST_*.
//
// Resolution order (highest → lowest precedence):
//   1. `overrides` passed to loadConfig()
//   2. `process.env.BEMATIST_*` (and legacy DEVMETRICS_*)
//   3. `~/.bematist/config.env` (KEY=VALUE shell-style file, written by
//      `bematist config set` or the install.sh --endpoint/--token flags)
//   4. Hard-coded defaults
//
// The config.env file is persisted across shells so distro-package
// post-install hooks and the `curl | sh` installer don't require a session-
// scoped `export`. See dev-docs/m5-installer-plan.md §F1.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { configEnvPath, dataDir as defaultDataDir } from "@bematist/config";

/** Expand a leading `~/` to $HOME. Mirrors the helper in packages/config —
 *  re-implemented here because the env-resolution path bypasses paths.ts's
 *  public dataDir() for `BEMATIST_DATA_DIR` overrides and still needs to
 *  normalize user-supplied tildes. */
function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

export type Tier = "A" | "B" | "C";
export type ConfigSource = "override" | "env" | "file" | "default";

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
  /**
   * Hard-kill watchdog timeout. Bug #6 fix: adapters that ignore
   * AbortSignal can wedge the orchestrator. Hard-kill fires strictly
   * *after* `perPollTimeoutMs` and stops awaiting a non-responsive
   * adapter's promise. Default: `max(perPollTimeoutMs * 2,
   * perPollTimeoutMs + 30s)`, computed at runtime when 0. Env:
   * `BEMATIST_HARD_KILL_MS`.
   */
  hardKillMs: number;
  /**
   * Quarantine window after 3 consecutive hard-kills. While quarantined,
   * an adapter's poll is skipped entirely. Strikes reset on first
   * successful poll after expiry. Default 5 minutes. Env:
   * `BEMATIST_ADAPTER_QUARANTINE_MS`.
   */
  adapterQuarantineMs: number;
  /**
   * Milliseconds between Journal.prune() ticks. Prunes drop submitted
   * rows past `journalSubmittedRetentionDays` and dead-letter rows past
   * `journalDeadLetterRetentionDays`, keeping the SQLite journal file
   * bounded on long-running daemons. Default 24h. A prune also runs on
   * startup (a few seconds after boot) so short-lived daemons still
   * get one GC pass. Env: `BEMATIST_JOURNAL_PRUNE_INTERVAL_MS`.
   */
  journalPruneIntervalMs: number;
  /**
   * Days to retain successfully-submitted rows in the journal before
   * prune() drops them. The append-only egress.jsonl still carries the
   * full audit trail. Default 14. Env:
   * `BEMATIST_JOURNAL_SUBMITTED_RETENTION_DAYS`.
   */
  journalSubmittedRetentionDays: number;
  /**
   * Days to retain dead-letter rows before prune() drops them. Kept
   * longer than submitted rows so `bematist audit --tail` can still
   * explain why a row was dropped. Default 90. Env:
   * `BEMATIST_JOURNAL_DEAD_LETTER_RETENTION_DAYS`.
   */
  journalDeadLetterRetentionDays: number;
}

export type ConfigSources = Record<keyof CollectorConfig, ConfigSource>;

export interface LoadedConfig {
  config: CollectorConfig;
  sources: ConfigSources;
}

/**
 * Parse a shell-style KEY=VALUE file. Lines starting with `#` and blank
 * lines are skipped. Surrounding single or double quotes are stripped.
 * Malformed lines warn and are dropped — never fatal. Keys are validated
 * against `^[A-Z_][A-Z0-9_]*$` so a typo can't shadow an unrelated env var.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) {
      console.warn(`bematist: ignoring malformed line in config.env: ${raw}`);
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      console.warn(`bematist: ignoring non-env key in config.env: ${key}`);
      continue;
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readFileVars(path: string): Record<string, string> {
  try {
    const content = readFileSync(path, "utf8");
    return parseEnvFile(content);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return {};
    console.warn(`bematist: could not read ${path}: ${err.message}`);
    return {};
  }
}

interface Resolved<T> {
  value: T;
  source: ConfigSource;
}

function resolveStr(
  envName: string,
  fileVars: Record<string, string>,
  fallback: string,
  legacy?: string,
): Resolved<string> {
  const envVal = process.env[envName];
  if (envVal !== undefined && envVal !== "") {
    return { value: envVal, source: "env" };
  }
  if (legacy) {
    const legacyVal = process.env[legacy];
    if (legacyVal !== undefined && legacyVal !== "") {
      return { value: legacyVal, source: "env" };
    }
  }
  const fileVal = fileVars[envName];
  if (fileVal !== undefined && fileVal !== "") {
    return { value: fileVal, source: "file" };
  }
  if (legacy) {
    const fileLegacy = fileVars[legacy];
    if (fileLegacy !== undefined && fileLegacy !== "") {
      return { value: fileLegacy, source: "file" };
    }
  }
  return { value: fallback, source: "default" };
}

function resolveOptStr(envName: string, fileVars: Record<string, string>): Resolved<string | null> {
  const envVal = process.env[envName];
  if (envVal !== undefined && envVal !== "") {
    return { value: envVal, source: "env" };
  }
  const fileVal = fileVars[envName];
  if (fileVal !== undefined && fileVal !== "") {
    return { value: fileVal, source: "file" };
  }
  return { value: null, source: "default" };
}

function resolveInt(
  envName: string,
  fileVars: Record<string, string>,
  fallback: number,
): Resolved<number> {
  const raw = resolveStr(envName, fileVars, "");
  if (raw.source === "default") return { value: fallback, source: "default" };
  const n = Number.parseInt(raw.value, 10);
  if (!Number.isFinite(n)) return { value: fallback, source: "default" };
  return { value: n, source: raw.source };
}

function resolveBool(envName: string, fileVars: Record<string, string>): Resolved<boolean> {
  const raw = resolveStr(envName, fileVars, "");
  if (raw.source === "default") return { value: false, source: "default" };
  const low = raw.value.toLowerCase();
  return { value: low === "1" || low === "true" || low === "yes", source: raw.source };
}

function resolveTier(envName: string, fileVars: Record<string, string>): Resolved<Tier> {
  const raw = resolveStr(envName, fileVars, "");
  if (raw.source === "default" || !(raw.value === "A" || raw.value === "B" || raw.value === "C")) {
    return { value: "B", source: "default" };
  }
  return { value: raw.value as Tier, source: raw.source };
}

/**
 * Load config from env + `~/.bematist/config.env` + defaults.
 * `overrides` are merged last (for tests / explicit programmatic use).
 */
export function loadConfig(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
  return loadConfigWithSources(overrides).config;
}

/**
 * Same as loadConfig() but also surfaces which source each field came from.
 * `bematist doctor` uses this to annotate each resolved value.
 */
export function loadConfigWithSources(overrides: Partial<CollectorConfig> = {}): LoadedConfig {
  const fileVars = readFileVars(configEnvPath());

  const endpoint = (() => {
    const primary = resolveStr("BEMATIST_ENDPOINT", fileVars, "", "DEVMETRICS_ENDPOINT");
    if (primary.source !== "default") return primary;
    const legacy = resolveStr("BEMATIST_INGEST_HOST", fileVars, "", "DEVMETRICS_INGEST_HOST");
    if (legacy.source !== "default") return legacy;
    return { value: "http://localhost:8000", source: "default" as const };
  })();
  const token = resolveStr("BEMATIST_TOKEN", fileVars, "", "DEVMETRICS_TOKEN");
  const ingestOnlyTo = resolveOptStr("BEMATIST_INGEST_ONLY_TO", fileVars);
  const dataDirResolved = (() => {
    const v = resolveStr("BEMATIST_DATA_DIR", fileVars, "");
    if (v.source !== "default") {
      // Defensive expand: env/file might carry a literal `~/…` that Node
      // fs never resolves. Keeping the source label lets `doctor` still
      // surface provenance accurately.
      return { value: expandTilde(v.value), source: v.source };
    }
    return { value: defaultDataDir(), source: "default" as const };
  })();
  const logLevel = resolveStr("BEMATIST_LOG_LEVEL", fileVars, "warn");
  const dryRun = resolveBool("BEMATIST_DRY_RUN", fileVars);
  const tenantId = resolveStr("BEMATIST_ORG", fileVars, "solo");
  const engineerId = resolveStr("BEMATIST_ENGINEER", fileVars, "me");
  const deviceId = resolveStr("BEMATIST_DEVICE", fileVars, "localhost");
  const tier = resolveTier("BEMATIST_TIER", fileVars);
  // Defaults match what the M5 handoff had manually exported in Sebastian's
  // shell (BEMATIST_BATCH_SIZE=500, BEMATIST_POLL_TIMEOUT_MS=1800000).
  // Without these, fresh installs hit the 30s-per-poll race in the
  // orchestrator and silently dropped events on heavy first-poll backfills
  // (Walid had 4,971 JSONL files / 2.8 GB and lost all history).
  //
  // The orchestrator now also honors signal.aborted so even if the timeout
  // fires mid-backfill, adapters return what they've emitted so far instead
  // of the old discard-everything behavior. 1 hour gives room for
  // multi-GB first-poll scans; subsequent polls hit the signature cache
  // and finish in milliseconds.
  const batchSize = resolveInt("BEMATIST_BATCH_SIZE", fileVars, 500);
  const pollIntervalMs = resolveInt("BEMATIST_POLL_INTERVAL_MS", fileVars, 5_000);
  const flushIntervalMs = resolveInt("BEMATIST_FLUSH_INTERVAL_MS", fileVars, 1_000);
  const adapterConcurrency = resolveInt("BEMATIST_CONCURRENCY", fileVars, 4);
  const perPollTimeoutMs = resolveInt("BEMATIST_POLL_TIMEOUT_MS", fileVars, 3_600_000);
  // hardKillMs default = 0, which the orchestrator treats as "compute from
  // perPollTimeoutMs at runtime." An explicit positive override via env/
  // file is honored as-is. We don't compute the default here because
  // perPollTimeoutMs may itself be overridden later (e.g. via tests).
  const hardKillMs = resolveInt("BEMATIST_HARD_KILL_MS", fileVars, 0);
  const adapterQuarantineMs = resolveInt("BEMATIST_ADAPTER_QUARANTINE_MS", fileVars, 5 * 60 * 1000);
  // Journal GC: default 24h between prune ticks. Submitted rows retained
  // 14d (the egress.jsonl still has the audit trail); dead-letter rows
  // retained 90d so `bematist audit --tail` can explain historical drops.
  const journalPruneIntervalMs = resolveInt(
    "BEMATIST_JOURNAL_PRUNE_INTERVAL_MS",
    fileVars,
    86_400_000,
  );
  const journalSubmittedRetentionDays = resolveInt(
    "BEMATIST_JOURNAL_SUBMITTED_RETENTION_DAYS",
    fileVars,
    14,
  );
  const journalDeadLetterRetentionDays = resolveInt(
    "BEMATIST_JOURNAL_DEAD_LETTER_RETENTION_DAYS",
    fileVars,
    90,
  );

  const config: CollectorConfig = {
    endpoint: endpoint.value,
    token: token.value,
    ingestOnlyTo: ingestOnlyTo.value,
    dataDir: dataDirResolved.value,
    logLevel: logLevel.value,
    dryRun: dryRun.value,
    tenantId: tenantId.value,
    engineerId: engineerId.value,
    deviceId: deviceId.value,
    tier: tier.value,
    batchSize: batchSize.value,
    pollIntervalMs: pollIntervalMs.value,
    flushIntervalMs: flushIntervalMs.value,
    adapterConcurrency: adapterConcurrency.value,
    perPollTimeoutMs: perPollTimeoutMs.value,
    hardKillMs: hardKillMs.value,
    adapterQuarantineMs: adapterQuarantineMs.value,
    journalPruneIntervalMs: journalPruneIntervalMs.value,
    journalSubmittedRetentionDays: journalSubmittedRetentionDays.value,
    journalDeadLetterRetentionDays: journalDeadLetterRetentionDays.value,
    ...overrides,
  };

  const sources: ConfigSources = {
    endpoint: "override" in overrides ? "override" : endpoint.source,
    token: token.source,
    ingestOnlyTo: ingestOnlyTo.source,
    dataDir: dataDirResolved.source,
    logLevel: logLevel.source,
    dryRun: dryRun.source,
    tenantId: tenantId.source,
    engineerId: engineerId.source,
    deviceId: deviceId.source,
    tier: tier.source,
    batchSize: batchSize.source,
    pollIntervalMs: pollIntervalMs.source,
    flushIntervalMs: flushIntervalMs.source,
    adapterConcurrency: adapterConcurrency.source,
    perPollTimeoutMs: perPollTimeoutMs.source,
    hardKillMs: hardKillMs.source,
    adapterQuarantineMs: adapterQuarantineMs.source,
    journalPruneIntervalMs: journalPruneIntervalMs.source,
    journalSubmittedRetentionDays: journalSubmittedRetentionDays.source,
    journalDeadLetterRetentionDays: journalDeadLetterRetentionDays.source,
  };

  for (const k of Object.keys(overrides) as Array<keyof CollectorConfig>) {
    sources[k] = "override";
  }

  return { config, sources };
}

/** Collector version — surfaced by `bematist --version` / `status`.
 *  Keep in sync with apps/collector/package.json at release time. A future
 *  improvement is to inject this from package.json via a build step; for
 *  now it's manually bumped per tag. */
export const COLLECTOR_VERSION = "0.2.0";
