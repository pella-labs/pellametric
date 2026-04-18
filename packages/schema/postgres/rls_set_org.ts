import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/**
 * Run `fn` inside a transaction with `app.current_org_id = <orgId>` set.
 * After commit/rollback the setting is released — subsequent queries
 * outside the transaction return 0 rows (RLS default-deny).
 *
 * App code connecting as the `app_bematist` role MUST wrap every query
 * in this helper. Postgres superuser bypasses RLS, so only migrations
 * and DB admin should connect as postgres.
 *
 * Contract 09 invariant 4: cross-tenant probe must return 0 rows.
 */
export async function withOrg<T>(
  db: PostgresJsDatabase<Record<string, unknown>>,
  orgId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
    throw new Error("withOrg: orgId must be a UUID");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL app.current_org_id = '${orgId}'`));
    return fn();
  });
}
