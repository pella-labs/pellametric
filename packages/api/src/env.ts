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

/**
 * Runtime gate for compliance-heavy surfaces (Bill of Rights, future DPA /
 * works-agreement / tier-C opt-in / erasure UI / audit log). Off by default
 * so the demo path isn't cluttered while the real compliance work ships on
 * a separate branch. Read at request time — never inlined at build.
 *
 * The surfaces themselves are LOCKED product (PRD §12, D7/D20/D30); this
 * flag only controls whether the UI is exposed in a given deploy.
 */
export function isComplianceEnabled(): boolean {
  const v = process.env.BEMATIST_COMPLIANCE_ENABLED;
  return v === "true" || v === "1";
}
