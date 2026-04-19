import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { runConfig } from "./config";

let tmpDir: string;
let configPath: string;
let savedCfg: string | undefined;
let savedData: string | undefined;
let stdoutChunks: string[] = [];
let stderrChunks: string[] = [];
const origStdoutWrite = process.stdout.write.bind(process.stdout);
const origStderrWrite = process.stderr.write.bind(process.stderr);
const origLog = console.log;
const origErr = console.error;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "bematist-configcmd-"));
  configPath = join(tmpDir, "config.env");
  savedCfg = process.env.BEMATIST_CONFIG_ENV_PATH;
  savedData = process.env.BEMATIST_DATA_DIR;
  process.env.BEMATIST_CONFIG_ENV_PATH = configPath;
  process.env.BEMATIST_DATA_DIR = tmpDir;
  stdoutChunks = [];
  stderrChunks = [];
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stderr.write;
  console.log = (...a: unknown[]) => {
    stdoutChunks.push(`${a.join(" ")}\n`);
  };
  console.error = (...a: unknown[]) => {
    stderrChunks.push(`${a.join(" ")}\n`);
  };
});

afterEach(() => {
  process.stdout.write = origStdoutWrite;
  process.stderr.write = origStderrWrite;
  console.log = origLog;
  console.error = origErr;
  rmSync(tmpDir, { recursive: true, force: true });
  if (savedCfg === undefined) delete process.env.BEMATIST_CONFIG_ENV_PATH;
  else process.env.BEMATIST_CONFIG_ENV_PATH = savedCfg;
  if (savedData === undefined) delete process.env.BEMATIST_DATA_DIR;
  else process.env.BEMATIST_DATA_DIR = savedData;
});

test("config set writes key to file", async () => {
  await runConfig(["set", "endpoint", "https://ingest.test"]);
  expect(existsSync(configPath)).toBe(true);
  const body = readFileSync(configPath, "utf8");
  expect(body).toContain("BEMATIST_ENDPOINT=https://ingest.test");
});

test("config set creates the file at mode 0600", async () => {
  if (platform() === "win32") return; // Windows has no POSIX mode bits
  await runConfig(["set", "token", "bm_secret_value_long_enough"]);
  const mode = statSync(configPath).mode & 0o777;
  expect(mode).toBe(0o600);
});

test("config set rejects unknown key", async () => {
  const exitOrig = process.exit;
  let exitCode: number | undefined;
  process.exit = ((code?: number) => {
    exitCode = code;
    throw new Error("exit");
  }) as typeof process.exit;
  try {
    await runConfig(["set", "not-a-key", "x"]).catch(() => {});
  } finally {
    process.exit = exitOrig;
  }
  expect(exitCode).toBe(2);
  expect(stderrChunks.join("")).toContain('unknown key "not-a-key"');
});

test("config set preserves other existing keys", async () => {
  await runConfig(["set", "endpoint", "https://one.test"]);
  await runConfig(["set", "token", "bm_abc"]);
  const body = readFileSync(configPath, "utf8");
  expect(body).toContain("BEMATIST_ENDPOINT=https://one.test");
  expect(body).toContain("BEMATIST_TOKEN=bm_abc");
});

test("config set overwrites a key on re-set", async () => {
  await runConfig(["set", "endpoint", "https://old.test"]);
  await runConfig(["set", "endpoint", "https://new.test"]);
  const body = readFileSync(configPath, "utf8");
  expect(body).toContain("BEMATIST_ENDPOINT=https://new.test");
  expect(body).not.toContain("BEMATIST_ENDPOINT=https://old.test");
});

test("config get prints the raw value to stdout", async () => {
  await runConfig(["set", "endpoint", "https://printable.test"]);
  stdoutChunks = [];
  await runConfig(["get", "endpoint"]);
  expect(stdoutChunks.join("")).toBe("https://printable.test\n");
});

test("config get exits 1 with stderr when key unset", async () => {
  const exitOrig = process.exit;
  let exitCode: number | undefined;
  process.exit = ((code?: number) => {
    exitCode = code;
    throw new Error("exit");
  }) as typeof process.exit;
  try {
    await runConfig(["get", "endpoint"]).catch(() => {});
  } finally {
    process.exit = exitOrig;
  }
  expect(exitCode).toBe(1);
  expect(stderrChunks.join("")).toContain("not set in config.env");
});

test("config list masks token in output", async () => {
  await runConfig(["set", "token", "bm_secret_value_long_abcdef"]);
  await runConfig(["set", "endpoint", "https://visible.test"]);
  stdoutChunks = [];
  await runConfig(["list"]);
  const out = stdoutChunks.join("");
  expect(out).toContain("endpoint = https://visible.test");
  expect(out).toContain("token =");
  expect(out).not.toContain("bm_secret_value_long_abcdef");
});

test("config unset removes key from file", async () => {
  await runConfig(["set", "endpoint", "https://bye.test"]);
  await runConfig(["unset", "endpoint"]);
  const body = readFileSync(configPath, "utf8");
  expect(body).not.toContain("BEMATIST_ENDPOINT");
});

test("config path prints resolved config file location", async () => {
  stdoutChunks = [];
  await runConfig(["path"]);
  expect(stdoutChunks.join("").trim()).toBe(configPath);
});

test("config with no subcommand prints usage", async () => {
  await runConfig([]);
  const out = stdoutChunks.join("");
  expect(out).toContain("bematist config");
  expect(out).toContain("set <key>");
});
