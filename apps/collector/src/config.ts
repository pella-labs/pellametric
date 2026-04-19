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
import { configEnvPath, dataDir as defaultDataDir } from "@bematist/config";

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

function resolveOptStr(
  envName: string,
  fileVars: Record<string, string>,
): Resolved<string | null> {
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
export function loadConfigWithSources(
  overrides: Partial<CollectorConfig> = {},
): LoadedConfig {
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
    if (v.source !== "default") return v;
    return { value: defaultDataDir(), source: "default" as const };
  })();
  const logLevel = resolveStr("BEMATIST_LOG_LEVEL", fileVars, "warn");
  const dryRun = resolveBool("BEMATIST_DRY_RUN", fileVars);
  const tenantId = resolveStr("BEMATIST_ORG", fileVars, "solo");
  const engineerId = resolveStr("BEMATIST_ENGINEER", fileVars, "me");
  const deviceId = resolveStr("BEMATIST_DEVICE", fileVars, "localhost");
  const tier = resolveTier("BEMATIST_TIER", fileVars);
  const batchSize = resolveInt("BEMATIST_BATCH_SIZE", fileVars, 10);
  const pollIntervalMs = resolveInt("BEMATIST_POLL_INTERVAL_MS", fileVars, 5_000);
  const flushIntervalMs = resolveInt("BEMATIST_FLUSH_INTERVAL_MS", fileVars, 1_000);
  const adapterConcurrency = resolveInt("BEMATIST_CONCURRENCY", fileVars, 4);
  const perPollTimeoutMs = resolveInt("BEMATIST_POLL_TIMEOUT_MS", fileVars, 30_000);

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
  };

  for (const k of Object.keys(overrides) as Array<keyof CollectorConfig>) {
    sources[k] = "override";
  }

  return { config, sources };
}

/** Collector version — surfaced by `bematist --version` / `status`. */
export const COLLECTOR_VERSION = "0.1.0";
