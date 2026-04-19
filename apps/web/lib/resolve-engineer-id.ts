// Resolve session identity → CH engineer_id.
//
// Gap this closes: ingest stores events with engineer_id = developer.id
// (the row in the `developers` table, keyed off the ingest token). The
// dashboard gets ctx.actor_id = user_id (Better Auth primary key). Those
// are DIFFERENT ids, even for the same person — so queries filtering by
// actor_id return 0 rows despite the data being there.
//
// Lookup table: developers (org_id, user_id) → developer.id. One row per
// user per org. Memoized per-request via in-memory cache keyed on
// (org_id, user_id) since the mapping never changes.

import "server-only";
import { getDbClients } from "./db";

const cache = new Map<string, string>();

export async function resolveEngineerId(
  orgId: string,
  userId: string,
): Promise<string | null> {
  const key = `${orgId}|${userId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { pg } = getDbClients();
  const rows = await pg.query<{ id: string }>(
    `SELECT id FROM developers WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
    [orgId, userId],
  );
  const engineerId = rows[0]?.id ?? null;
  if (engineerId) cache.set(key, engineerId);
  return engineerId;
}
