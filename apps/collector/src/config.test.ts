import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { loadConfig, loadConfigWithSources, parseEnvFile } from "./config";

const saved: Record<string, string | undefined> = {};
const bmVars = [
  "BEMATIST_ENDPOINT",
  "BEMATIST_INGEST_HOST",
  "BEMATIST_TOKEN",
  "BEMATIST_INGEST_ONLY_TO",
  "BEMATIST_DATA_DIR",
  "BEMATIST_LOG_LEVEL",
  "BEMATIST_DRY_RUN",
  "BEMATIST_ORG",
  "BEMATIST_ENGINEER",
  "BEMATIST_DEVICE",
  "BEMATIST_TIER",
  "BEMATIST_BATCH_SIZE",
  "BEMATIST_POLL_INTERVAL_MS",
  "BEMATIST_FLUSH_INTERVAL_MS",
  "BEMATIST_CONCURRENCY",
  "BEMATIST_POLL_TIMEOUT_MS",
  "BEMATIST_CONFIG_ENV_PATH",
  "DEVMETRICS_TOKEN",
  "DEVMETRICS_ENDPOINT",
  "DEVMETRICS_INGEST_HOST",
];

let tmpDir: string;

beforeEach(() => {
  for (const k of bmVars) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  tmpDir = mkdtempSync(join(tmpdir(), "bematist-config-test-"));
  process.env.BEMATIST_CONFIG_ENV_PATH = join(tmpDir, "config.env");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  for (const k of bmVars) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function writeConfigEnv(contents: string): void {
  const path = process.env.BEMATIST_CONFIG_ENV_PATH;
  if (!path) throw new Error("test setup: BEMATIST_CONFIG_ENV_PATH unset");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(path, contents, "utf8");
}

test("loadConfig has sensible defaults", () => {
  const cfg = loadConfig();
  expect(cfg.endpoint).toBe("http://localhost:8000");
  expect(cfg.token).toBe("");
  expect(cfg.dryRun).toBe(false);
  expect(cfg.tier).toBe("B");
  expect(cfg.logLevel).toBe("warn");
  expect(cfg.batchSize).toBe(10);
});

test("BEMATIST_ENDPOINT overrides default", () => {
  process.env.BEMATIST_ENDPOINT = "https://ingest.example.test";
  expect(loadConfig().endpoint).toBe("https://ingest.example.test");
});

test("falls back to DEVMETRICS_TOKEN when BEMATIST_TOKEN unset", () => {
  process.env.DEVMETRICS_TOKEN = "dm_legacy";
  expect(loadConfig().token).toBe("dm_legacy");
});

test("BEMATIST_TOKEN wins over DEVMETRICS_TOKEN", () => {
  process.env.BEMATIST_TOKEN = "bm_new";
  process.env.DEVMETRICS_TOKEN = "dm_legacy";
  expect(loadConfig().token).toBe("bm_new");
});

test("BEMATIST_DRY_RUN=1 flips dryRun true", () => {
  process.env.BEMATIST_DRY_RUN = "1";
  expect(loadConfig().dryRun).toBe(true);
});

test("BEMATIST_DRY_RUN=true flips dryRun true", () => {
  process.env.BEMATIST_DRY_RUN = "true";
  expect(loadConfig().dryRun).toBe(true);
});

test("invalid BEMATIST_TIER falls back to B", () => {
  process.env.BEMATIST_TIER = "Z";
  expect(loadConfig().tier).toBe("B");
});

test("BEMATIST_BATCH_SIZE parses int", () => {
  process.env.BEMATIST_BATCH_SIZE = "25";
  expect(loadConfig().batchSize).toBe(25);
});

test("invalid BEMATIST_BATCH_SIZE falls back to 10", () => {
  process.env.BEMATIST_BATCH_SIZE = "not-a-number";
  expect(loadConfig().batchSize).toBe(10);
});

test("overrides arg wins over env", () => {
  process.env.BEMATIST_ENDPOINT = "https://env.test";
  expect(loadConfig({ endpoint: "https://override.test" }).endpoint).toBe("https://override.test");
});

test("empty env var treated as unset", () => {
  process.env.BEMATIST_ENDPOINT = "";
  expect(loadConfig().endpoint).toBe("http://localhost:8000");
});

// ---- File-backed config (~/.bematist/config.env) ----

test("config.env file supplies endpoint when env unset", () => {
  writeConfigEnv("BEMATIST_ENDPOINT=https://from-file.test\n");
  const { config, sources } = loadConfigWithSources();
  expect(config.endpoint).toBe("https://from-file.test");
  expect(sources.endpoint).toBe("file");
});

test("env wins over config.env file", () => {
  writeConfigEnv("BEMATIST_ENDPOINT=https://from-file.test\n");
  process.env.BEMATIST_ENDPOINT = "https://from-env.test";
  const { config, sources } = loadConfigWithSources();
  expect(config.endpoint).toBe("https://from-env.test");
  expect(sources.endpoint).toBe("env");
});

test("config.env file supplies token", () => {
  writeConfigEnv("BEMATIST_TOKEN=bm_from_file_abc\n");
  const { config, sources } = loadConfigWithSources();
  expect(config.token).toBe("bm_from_file_abc");
  expect(sources.token).toBe("file");
});

test("defaults report source = default", () => {
  const { sources } = loadConfigWithSources();
  expect(sources.endpoint).toBe("default");
  expect(sources.token).toBe("default");
  expect(sources.logLevel).toBe("default");
});

test("config.env parses quoted values", () => {
  writeConfigEnv('BEMATIST_ENDPOINT="https://quoted.test"\nBEMATIST_TOKEN=\'bm_single\'\n');
  const { config } = loadConfigWithSources();
  expect(config.endpoint).toBe("https://quoted.test");
  expect(config.token).toBe("bm_single");
});

test("config.env ignores comments + blank lines", () => {
  writeConfigEnv(
    ["# a comment", "", "BEMATIST_ENDPOINT=https://ok.test", "  # indented comment"].join("\n"),
  );
  expect(loadConfig().endpoint).toBe("https://ok.test");
});

test("malformed config.env lines are skipped without crashing", () => {
  writeConfigEnv(
    ["not-an-assignment", "=no-key", "BEMATIST_ENDPOINT=https://still-works.test"].join("\n"),
  );
  expect(loadConfig().endpoint).toBe("https://still-works.test");
});

test("config.env keys that aren't UPPER_SNAKE are ignored", () => {
  writeConfigEnv("endpoint=lowercase-ignored\nBEMATIST_ENDPOINT=https://upper.test\n");
  expect(loadConfig().endpoint).toBe("https://upper.test");
});

test("missing config.env file is not an error", () => {
  // no write — file doesn't exist
  const { config, sources } = loadConfigWithSources();
  expect(config.endpoint).toBe("http://localhost:8000");
  expect(sources.endpoint).toBe("default");
});

test("overrides beat both env and file", () => {
  writeConfigEnv("BEMATIST_ENDPOINT=https://from-file.test\n");
  process.env.BEMATIST_ENDPOINT = "https://from-env.test";
  const { config, sources } = loadConfigWithSources({ endpoint: "https://from-override.test" });
  expect(config.endpoint).toBe("https://from-override.test");
  expect(sources.endpoint).toBe("override");
});

test("BEMATIST_INGEST_HOST works from file as legacy endpoint alias", () => {
  writeConfigEnv("BEMATIST_INGEST_HOST=https://ingest-host-file.test\n");
  expect(loadConfig().endpoint).toBe("https://ingest-host-file.test");
});

// ---- parseEnvFile direct tests ----

test("parseEnvFile handles = inside value", () => {
  const out = parseEnvFile("BEMATIST_TOKEN=abc=def=ghi\n");
  expect(out.BEMATIST_TOKEN).toBe("abc=def=ghi");
});

test("parseEnvFile strips surrounding whitespace on key", () => {
  const out = parseEnvFile("  BEMATIST_ENDPOINT  =  https://ws.test  \n");
  expect(out.BEMATIST_ENDPOINT).toBe("https://ws.test");
});

test("parseEnvFile handles CRLF line endings", () => {
  const out = parseEnvFile("BEMATIST_ENDPOINT=https://a.test\r\nBEMATIST_TOKEN=b\r\n");
  expect(out.BEMATIST_ENDPOINT).toBe("https://a.test");
  expect(out.BEMATIST_TOKEN).toBe("b");
});
