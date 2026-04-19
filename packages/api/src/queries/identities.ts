import type { Ctx } from "../auth";
import type { DeveloperIdentity } from "../schemas/common";

/**
 * Helpers for the compliance-OFF demo path: turn an `engineer_id` (or set of
 * them) into a plaintext `DeveloperIdentity` map. Two paths:
 *
 *   - **Fixture mode** (`USE_FIXTURES != "0"`): synthesize a deterministic
 *     identity per engineer_id so demo dashboards have human-shaped names
 *     even though no real `developers` row exists. The same engineer_id
 *     always maps to the same name across renders.
 *   - **Real mode**: JOIN through `developers → users → betterAuthUser` in
 *     Postgres and return `{name?, email, image?}` per engineer_id.
 *
 * Callers must gate calls on `isComplianceEnabled() === false` from
 * `@bematist/api`. The compliance-ON path never invokes these helpers — the
 * audit posture stays unchanged.
 */

const FIXTURE_NAMES: ReadonlyArray<readonly [string, string]> = [
  ["dev-ada", "Ada Marquez"],
  ["dev-lin", "Lin Aung"],
  ["dev-ren", "Ren Okonkwo"],
  ["dev-sam", "Sam Kowalski"],
  ["dev-kai", "Kai Tanaka"],
  ["dev-vic", "Vic Patel"],
];
const FIXTURE_NAME_MAP = new Map<string, string>(FIXTURE_NAMES);

const FIXTURE_FALLBACK_GIVEN_NAMES = [
  "Alex",
  "Blake",
  "Cameron",
  "Drew",
  "Eli",
  "Finley",
  "Gray",
  "Harper",
  "Indigo",
  "Jules",
  "Kit",
  "Lane",
];

/**
 * Synthesize a fixture identity for a single engineer_id. Deterministic on
 * the input string so re-renders produce stable names.
 */
export function buildFixtureIdentity(engineerId: string): DeveloperIdentity {
  const known = FIXTURE_NAME_MAP.get(engineerId);
  if (known) {
    const slug = engineerId.replace(/^dev-/, "");
    return {
      name: known,
      email: `${slug}@bematist.test`,
      image: null,
    };
  }
  // Deterministic fallback for unknown engineer_ids (e.g. seeded UUIDs).
  const seed = fnv1a(engineerId);
  const given = FIXTURE_FALLBACK_GIVEN_NAMES[seed % FIXTURE_FALLBACK_GIVEN_NAMES.length] ?? "Alex";
  const slug = `engineer-${(seed % 1000).toString().padStart(3, "0")}`;
  return {
    name: given,
    email: `${slug}@bematist.test`,
    image: null,
  };
}

/**
 * Real-branch lookup: JOIN through `developers → users → betterAuthUser`
 * and return identity per developer id. Unknown ids are simply absent
 * from the returned map (caller falls back to whatever default the UI uses).
 *
 * Org-scoped: uses `ctx.tenant_id` so a developer outside the caller's org
 * never resolves, even if the id is guessable.
 */
export async function fetchIdentitiesByDeveloperId(
  ctx: Ctx,
  developerIds: readonly string[],
): Promise<Record<string, DeveloperIdentity>> {
  if (developerIds.length === 0) return {};

  const rows = await ctx.db.pg.query<{
    developer_id: string;
    name: string | null;
    email: string;
    image: string | null;
  }>(
    `SELECT
       d.id              AS developer_id,
       bau.name          AS name,
       u.email           AS email,
       bau.image         AS image
     FROM developers d
     JOIN users u ON u.id = d.user_id
     LEFT JOIN better_auth_user bau ON bau.id = u.better_auth_user_id
     WHERE d.org_id = $1
       AND d.id = ANY($2::uuid[])`,
    [ctx.tenant_id, developerIds],
  );

  const out: Record<string, DeveloperIdentity> = {};
  for (const r of rows) {
    out[r.developer_id] = {
      name: r.name,
      email: r.email,
      image: r.image,
    };
  }
  return out;
}

/**
 * Real-branch lookup keyed by `engineer_id_hash` (cluster-contributors
 * surface). The caller passes a map from raw developer id → hash so we can
 * rekey the identity result after the JOIN. Mirrors
 * `fetchIdentitiesByDeveloperId` otherwise.
 */
export async function fetchIdentitiesByHash(
  ctx: Ctx,
  hashByDeveloperId: ReadonlyMap<string, string>,
): Promise<Record<string, DeveloperIdentity>> {
  const developerIds = Array.from(hashByDeveloperId.keys());
  const byDeveloperId = await fetchIdentitiesByDeveloperId(ctx, developerIds);
  const out: Record<string, DeveloperIdentity> = {};
  for (const [developerId, hash] of hashByDeveloperId) {
    const identity = byDeveloperId[developerId];
    if (identity) out[hash] = identity;
  }
  return out;
}

/** Tiny FNV-1a for stable seeding — no crypto needed. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
