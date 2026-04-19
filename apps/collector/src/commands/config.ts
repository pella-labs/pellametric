// `bematist config {get,set,list,unset,path}` — persist BEMATIST_* config to
// `~/.bematist/config.env` so distro-package post-install hooks and the
// `curl | sh` installer don't require a session-scoped `export`.
//
// File format is shell-source-compatible (KEY=VALUE, one per line) so a user
// running `source ~/.bematist/config.env` inside a shell picks up the same
// values. Written at mode 0600 because `BEMATIST_TOKEN` is a bearer secret.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { atomicWrite, configEnvPath, dataDir } from "@bematist/config";
import { parseEnvFile } from "../config";

// User-friendly CLI key → env var name. Keep this list small and honest —
// only the knobs a new teammate actually flips. Power users can still hand-
// edit the file or use BEMATIST_* env vars directly.
const KEY_TO_ENV: Record<string, string> = {
  endpoint: "BEMATIST_ENDPOINT",
  token: "BEMATIST_TOKEN",
  "log-level": "BEMATIST_LOG_LEVEL",
  "poll-timeout-ms": "BEMATIST_POLL_TIMEOUT_MS",
  "batch-size": "BEMATIST_BATCH_SIZE",
  "ingest-only-to": "BEMATIST_INGEST_ONLY_TO",
  "data-dir": "BEMATIST_DATA_DIR",
  tier: "BEMATIST_TIER",
  org: "BEMATIST_ORG",
};

// Keys whose value should never be printed in full. `bematist config list`
// masks these; `get` still prints them because the user asked explicitly.
const SECRET_KEYS = new Set(["token"]);

function usage(): string {
  const keys = Object.keys(KEY_TO_ENV).sort().join(", ");
  return [
    "bematist config — persisted settings in ~/.bematist/config.env",
    "",
    "Usage:",
    "  bematist config set <key> <value>",
    "  bematist config get <key>",
    "  bematist config list",
    "  bematist config unset <key>",
    "  bematist config path",
    "",
    `Keys: ${keys}`,
  ].join("\n");
}

function resolveEnvName(cliKey: string): string | null {
  return KEY_TO_ENV[cliKey] ?? null;
}

function loadFile(): Record<string, string> {
  const path = configEnvPath();
  if (!existsSync(path)) return {};
  return parseEnvFile(readFileSync(path, "utf8"));
}

function serialize(vars: Record<string, string>): string {
  const header =
    "# bematist collector config — written by `bematist config` or install.sh.\n" +
    "# See dev-docs/m5-installer-plan.md. Safe to hand-edit; preserve KEY=VALUE form.\n";
  const lines = Object.entries(vars)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  return `${header}${lines.join("\n")}\n`;
}

async function writeFile(vars: Record<string, string>): Promise<string> {
  const path = configEnvPath();
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  await atomicWrite(path, serialize(vars), { mode: 0o600 });
  return path;
}

function mask(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

async function runSet(cliKey: string | undefined, value: string | undefined): Promise<void> {
  if (!cliKey || value === undefined) {
    console.error("bematist config set: needs <key> <value>");
    console.error(usage());
    process.exit(2);
  }
  const envName = resolveEnvName(cliKey);
  if (!envName) {
    console.error(`bematist config set: unknown key "${cliKey}"`);
    console.error(usage());
    process.exit(2);
  }
  const vars = loadFile();
  vars[envName] = value;
  const _path = await writeFile(vars);
  const _shown = SECRET_KEYS.has(cliKey) ? mask(value) : value;
}

async function runUnset(cliKey: string | undefined): Promise<void> {
  if (!cliKey) {
    console.error("bematist config unset: needs <key>");
    process.exit(2);
  }
  const envName = resolveEnvName(cliKey);
  if (!envName) {
    console.error(`bematist config unset: unknown key "${cliKey}"`);
    process.exit(2);
  }
  const vars = loadFile();
  if (!(envName in vars)) {
    return;
  }
  delete vars[envName];
  const _path = await writeFile(vars);
}

function runGet(cliKey: string | undefined): void {
  if (!cliKey) {
    console.error("bematist config get: needs <key>");
    process.exit(2);
  }
  const envName = resolveEnvName(cliKey);
  if (!envName) {
    console.error(`bematist config get: unknown key "${cliKey}"`);
    process.exit(2);
  }
  const vars = loadFile();
  const v = vars[envName];
  if (v === undefined) {
    // Not an error — just an informational "not set in file". Callers can
    // chain with `bematist config list` / `doctor` for the full picture.
    console.error(`bematist: ${cliKey} is not set in config.env (env or default may still apply)`);
    process.exit(1);
  }
  // Print raw so shell scripts can substitute: VALUE=$(bematist config get endpoint)
  process.stdout.write(`${v}\n`);
}

function runList(): void {
  const vars = loadFile();
  if (Object.keys(vars).length === 0) {
    return;
  }
  // Reverse-map env name → CLI key so the listing uses friendly names.
  const envToCli = new Map(Object.entries(KEY_TO_ENV).map(([k, v]) => [v, k]));
  const _rows = Object.entries(vars)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([envName, value]) => {
      const cliKey = envToCli.get(envName) ?? envName.toLowerCase();
      const shown = SECRET_KEYS.has(cliKey) ? mask(value) : value;
      return `${cliKey} = ${shown}`;
    });
}

function runPath(): void {}

export async function runConfig(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "set":
      await runSet(rest[0], rest[1]);
      return;
    case "get":
      runGet(rest[0]);
      return;
    case "list":
    case "ls":
      runList();
      return;
    case "unset":
    case "rm":
      await runUnset(rest[0]);
      return;
    case "path":
      runPath();
      return;
    case undefined:
    case "-h":
    case "--help":
      return;
    default:
      console.error(`bematist config: unknown subcommand "${sub}"`);
      console.error(usage());
      process.exit(2);
  }
}
