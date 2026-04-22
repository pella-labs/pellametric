import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const COLLECTOR_VERSION = "0.0.7";
export const DEFAULT_URL = "https://pellametric.com";
export const DEFAULT_POLL_INTERVAL_MS = 10_000;

/** `~/.pella/` — root dir for config, cursors, and log files. */
export function dataDir(): string {
  return path.join(os.homedir(), ".pella");
}

/** `~/.pella/config.env` — KEY=VALUE file with PELLA_TOKEN and PELLA_URL. */
export function configEnvPath(): string {
  return path.join(dataDir(), "config.env");
}

/** `~/.pella/logs/` — launchd/service stdout+stderr sink. */
export function logsDir(): string {
  return path.join(dataDir(), "logs");
}

export interface CollectorConfig {
  token: string;
  url: string;
  pollIntervalMs: number;
  /** Only events with ts >= since are ingested. Default: no bound. */
  since: Date;
}

/**
 * Parse a KEY=VALUE env file. Ignores blank lines and `#` comments.
 * Values with trailing whitespace/CR are trimmed. Surrounding matching
 * quotes are stripped so hand-edits with quoted values work.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

/** Read ~/.pella/config.env merged with process.env. */
export function loadConfig(): CollectorConfig {
  const vars: Record<string, string> = {};
  const p = configEnvPath();
  if (fs.existsSync(p)) {
    Object.assign(vars, parseEnvFile(fs.readFileSync(p, "utf8")));
  }
  // process.env wins over config.env — lets users override per-invocation.
  for (const k of ["PELLA_TOKEN", "PELLA_URL", "PELLA_POLL_INTERVAL_MS", "PELLA_SINCE"]) {
    if (process.env[k]) vars[k] = process.env[k]!;
  }
  // Feature flags read directly off process.env elsewhere (e.g.
  // PELLA_SKIP_CURSOR in serve.ts) — propagate from config.env so users
  // can set them persistently without editing the launchd plist.
  for (const k of ["PELLA_SKIP_CURSOR"]) {
    if (vars[k] && !process.env[k]) process.env[k] = vars[k];
  }
  const token = vars.PELLA_TOKEN ?? "";
  const url = (vars.PELLA_URL || DEFAULT_URL).replace(/\/$/, "");
  const pollIntervalMs = vars.PELLA_POLL_INTERVAL_MS
    ? Math.max(1000, Number.parseInt(vars.PELLA_POLL_INTERVAL_MS, 10) || DEFAULT_POLL_INTERVAL_MS)
    : DEFAULT_POLL_INTERVAL_MS;
  const since = vars.PELLA_SINCE ? new Date(vars.PELLA_SINCE) : new Date(0);
  return { token, url, pollIntervalMs, since };
}

/**
 * Write ~/.pella/config.env with PELLA_TOKEN and PELLA_URL set,
 * preserving any other keys already in the file. Atomic (write-then-
 * rename) so a crash mid-write can't leave a half-file. Permissions
 * 0600; the token is a bearer credential.
 */
export function writeConfig(token: string, url: string): string {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const p = configEnvPath();
  const existing = fs.existsSync(p) ? parseEnvFile(fs.readFileSync(p, "utf8")) : {};
  existing.PELLA_TOKEN = token;
  existing.PELLA_URL = url;
  const header =
    "# pellametric collector config — written by `pella login`.\n" +
    "# Hand-editable: one KEY=VALUE per line. Comments start with #.\n";
  const body = Object.entries(existing)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${header}${body}\n`, { mode: 0o600 });
  fs.renameSync(tmp, p);
  return p;
}

/** Remove ~/.pella/config.env. Returns true if a file was removed. */
export function deleteConfig(): boolean {
  const p = configEnvPath();
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p);
  return true;
}
