import type { ClickHouseClient } from "@clickhouse/client";

/** Run EXPLAIN against a query with force_optimize_projection=1 and return raw output.
 *  force_optimize_projection makes the optimizer select a projection whenever one is
 *  applicable — which is what we want to gate on in tests. Without the setting, CH may
 *  skip projections on small tables even if they'd be preferred at scale. */
export async function explainWithProjection(
  client: ClickHouseClient,
  sql: string,
): Promise<string> {
  const res = await client.query({
    query: `EXPLAIN ${sql}`,
    clickhouse_settings: { force_optimize_projection: 1 },
    format: "TabSeparated",
  });
  return await res.text();
}

/** Run EXPLAIN without forcing projections; use to assert negative cases
 *  (e.g., a time-range query does NOT use repo_lookup). */
export async function explainNatural(client: ClickHouseClient, sql: string): Promise<string> {
  const res = await client.query({
    query: `EXPLAIN ${sql}`,
    format: "TabSeparated",
  });
  return await res.text();
}

/** Returns the projection table name from EXPLAIN output, or null.
 *  Projection reads show as `ReadFromMergeTree (<projection_name>)` while
 *  base reads show `ReadFromMergeTree (<db>.<table>)`. */
export function projectionUsed(explainText: string): string | null {
  const match = explainText.match(/ReadFromMergeTree \(([^)]+)\)/);
  if (!match) return null;
  const name = match[1];
  if (!name) return null;
  // Base reads include a dot (database.table); projection reads are bare names.
  return name.includes(".") ? null : name;
}
