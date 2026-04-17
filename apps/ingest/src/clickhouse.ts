// ClickHouse writer abstraction (Sprint-1 Phase-4, PRD §Phase 4, D-S1-7).
//
// The ingest server never calls `insert` directly — the WAL consumer
// (`wal/consumer.ts`) drains the Redis Stream and calls through this
// interface. This file keeps CH concerns off the hot request path and
// isolates the `@clickhouse/client` dependency (which is NOT installed in
// CI: the lazy import path errors with a friendly message instead).
//
// Two impls:
//   - `createLazyClickHouseWriter(cfg)` — lazy `await import("@clickhouse/client")`
//     on first insert. Tests never exercise this path (the dep is absent).
//   - `createInMemoryClickHouseWriter()` — records rows; configurable
//     ping result & insert-behavior for tests.
//
// Plan-B swap: when F15/INT0 24h soak flakes, flip `CLICKHOUSE_WRITER=sidecar`
// and route inserts over a UNIX socket to `apps/ingest-sidecar` (Go). The
// interface stays the same; only the `create*` call changes at boot.

import { pingClickHouse as pingClickHouseHttp } from "./lib/http";

export interface ClickHouseWriter {
  insert(rows: Record<string, unknown>[]): Promise<{ ok: true }>;
  ping(): Promise<boolean>;
}

export type ClickHouseConfig = {
  url: string;
  database: string;
  keep_alive_idle_socket_ttl_ms: number;
  request_timeout_ms: number;
  compression_request: boolean;
  compression_response: boolean;
  max_open_connections: number;
  table: string;
};

/**
 * Production-tuned defaults. `keep_alive_idle_socket_ttl_ms=2000` is the
 * F15/INT0 mitigation — NodeJS/Undici defaults to 4s; ClickHouse
 * closes idle connections around 3s, which races if kept-alive ttl > 3s and
 * manifests as ECONNRESET under load. 2000ms keeps us comfortably below the
 * server-side idle window.
 */
export const defaultClickHouseConfig: ClickHouseConfig = {
  url: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
  database: "bematist",
  keep_alive_idle_socket_ttl_ms: 2000,
  request_timeout_ms: 30000,
  compression_request: true,
  compression_response: true,
  max_open_connections: 10,
  table: "events",
};

// biome-ignore lint/suspicious/noExplicitAny: dynamic-import return is untyped
type ClickHouseModule = any;

/**
 * Injectable importer so tests can simulate the "dep missing" path without
 * actually uninstalling the package. Production callers use the default.
 */
export type ClickHouseImporter = () => Promise<ClickHouseModule>;

const defaultImporter: ClickHouseImporter = () =>
  // Optional dep; present in the workspace via @bematist/schema. If a future CI
  // image strips it, the caller's try/catch in ensureClient() converts the
  // MODULE_NOT_FOUND into `clickhouse:client-not-installed`.
  import("@clickhouse/client");

/**
 * Lazy ClickHouse client. Does NOT import `@clickhouse/client` at module
 * load — the import happens inside `insert` on first call. If the dep isn't
 * installed, throws `clickhouse:client-not-installed` so ops see exactly
 * what's missing instead of a `Cannot find module` crash.
 */
export function createLazyClickHouseWriter(
  cfg: ClickHouseConfig,
  importer: ClickHouseImporter = defaultImporter,
): ClickHouseWriter {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic client
  let client: any = null;
  let initFailed = false;

  async function ensureClient(): Promise<void> {
    if (client || initFailed) return;
    try {
      const mod = await importer();
      const createClient = mod?.createClient ?? mod?.default?.createClient;
      if (typeof createClient !== "function") {
        initFailed = true;
        throw new Error("clickhouse:client-not-installed");
      }
      client = createClient({
        url: cfg.url,
        database: cfg.database,
        keep_alive: { idle_socket_ttl: cfg.keep_alive_idle_socket_ttl_ms },
        request_timeout: cfg.request_timeout_ms,
        compression: {
          request: cfg.compression_request,
          response: cfg.compression_response,
        },
        max_open_connections: cfg.max_open_connections,
      });
    } catch (err) {
      initFailed = true;
      if (err instanceof Error && err.message === "clickhouse:client-not-installed") {
        throw err;
      }
      throw new Error("clickhouse:client-not-installed");
    }
  }

  return {
    async insert(rows: Record<string, unknown>[]): Promise<{ ok: true }> {
      await ensureClient();
      if (!client) throw new Error("clickhouse:client-not-installed");
      await client.insert({
        table: cfg.table,
        values: rows,
        format: "JSONEachRow",
      });
      return { ok: true };
    },
    async ping(): Promise<boolean> {
      return pingClickHouseHttp(cfg.url);
    },
  };
}

// ---- In-memory writer (dev + test) ---------------------------------------

export type InsertBehavior = "ok" | "throw-500" | "throw-timeout";

export interface InMemoryClickHouseWriter extends ClickHouseWriter {
  rows(): Record<string, unknown>[];
  setPingResult(b: boolean): void;
  setInsertBehavior(b: InsertBehavior): void;
  insertCallCount(): number;
  /** Last argument passed to `client.insert` (for consumer-test assertions). */
  lastInsertArgs(): { table: string; values: Record<string, unknown>[]; format: string } | null;
}

export function createInMemoryClickHouseWriter(): InMemoryClickHouseWriter {
  const rows: Record<string, unknown>[] = [];
  let pingResult = true;
  let behavior: InsertBehavior = "ok";
  let callCount = 0;
  let lastArgs: { table: string; values: Record<string, unknown>[]; format: string } | null = null;
  return {
    async insert(values: Record<string, unknown>[]): Promise<{ ok: true }> {
      callCount++;
      lastArgs = { table: "events", values, format: "JSONEachRow" };
      if (behavior === "throw-500") {
        throw new Error("clickhouse:500");
      }
      if (behavior === "throw-timeout") {
        throw new Error("clickhouse:timeout");
      }
      for (const v of values) rows.push(v);
      return { ok: true };
    },
    async ping(): Promise<boolean> {
      return pingResult;
    },
    rows(): Record<string, unknown>[] {
      return [...rows];
    },
    setPingResult(b: boolean): void {
      pingResult = b;
    },
    setInsertBehavior(b: InsertBehavior): void {
      behavior = b;
    },
    insertCallCount(): number {
      return callCount;
    },
    lastInsertArgs() {
      return lastArgs;
    },
  };
}
