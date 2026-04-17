/**
 * Runtime flag — are we still running against deterministic fixtures, or has
 * the tenant flipped to real DB reads?
 *
 * Evaluated lazily on every call so tests can toggle the env var between
 * cases. Default (`USE_FIXTURES` unset or "1") is the fixture path — M1
 * behavior is byte-identical to Sprint-1.
 *
 * Setting `USE_FIXTURES=0` flips the whole query layer to its real-DB branch.
 * Jorge's materialized views + seed land → M2 gate flips with this one line,
 * not a refactor sprint.
 */
export function useFixtures(): boolean {
  return process.env.USE_FIXTURES !== "0";
}
