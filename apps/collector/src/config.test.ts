import { afterEach, beforeEach, expect, test } from "bun:test";
import { loadConfig } from "./config";

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
  "DEVMETRICS_TOKEN",
  "DEVMETRICS_ENDPOINT",
  "DEVMETRICS_INGEST_HOST",
];

beforeEach(() => {
  for (const k of bmVars) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of bmVars) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

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
