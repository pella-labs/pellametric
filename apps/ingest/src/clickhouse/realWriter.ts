// Real ClickHouseWriter backed by @clickhouse/client (Sprint-1 follow-up A).
//
// This replaces the "lazy importer" path in createLazyClickHouseWriter for
// runtime boot — we now know @clickhouse/client is installed (pinned in
// apps/ingest/package.json) so we can eagerly `createClient`. The lazy
// variant stays in clickhouse.ts for tests and for backwards compat with the
// `CLICKHOUSE_WRITER=client` flag path.
//
// The interface matches ClickHouseWriter exactly. `ping()` reuses the small
// HTTP helper from lib/http — we don't call client.ping() because the
// @clickhouse/client one applies its own request-timeout semantics that
// conflict with the /readyz 2s budget.

import { createClient } from "@clickhouse/client";
import {
  type ClickHouseConfig,
  type ClickHouseWriter,
  defaultClickHouseConfig,
} from "../clickhouse";
import { pingClickHouse as pingClickHouseHttp } from "../lib/http";

export function createRealClickHouseWriter(cfg: Partial<ClickHouseConfig> = {}): ClickHouseWriter {
  const merged: ClickHouseConfig = { ...defaultClickHouseConfig, ...cfg };

  const client = createClient({
    url: merged.url,
    database: merged.database,
    keep_alive: { idle_socket_ttl: merged.keep_alive_idle_socket_ttl_ms },
    request_timeout: merged.request_timeout_ms,
    compression: {
      request: merged.compression_request,
      response: merged.compression_response,
    },
    max_open_connections: merged.max_open_connections,
  });

  return {
    async insert(rows: Record<string, unknown>[]): Promise<{ ok: true }> {
      await client.insert({
        table: merged.table,
        values: rows,
        format: "JSONEachRow",
      });
      return { ok: true };
    },
    async ping(): Promise<boolean> {
      // Stable 2s timeout over HTTP /ping — decoupled from insert request_timeout.
      return pingClickHouseHttp(merged.url);
    },
  };
}
