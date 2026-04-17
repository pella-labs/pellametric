/**
 * Eval runner — `bun run test:scoring`.
 *
 * Loads each JSONL fixture, runs production `score()`, compares to the
 * snapshotted `expected_final_als`. Reports MAE, max per-case error, and
 * per-archetype MAE. Exits 0 when all gates pass, 1 otherwise.
 *
 * Budget (CLAUDE.md §Testing Rules): < 30 s. Our 60 cases finish in < 100 ms.
 * At 500 cases the scoring function (pure math, no I/O) remains well under.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { score } from "../index";
import { GATES } from "./gates";
import type { ArchetypeTag, FixtureCase } from "./schema";

const FIXTURE_DIR = join(import.meta.dir, "..", "__fixtures__");

interface CaseResult {
  case_id: string;
  archetype_tag: ArchetypeTag;
  expected: number;
  actual: number;
  error: number;
  tolerance: number;
  within_tolerance: boolean;
}

interface FixtureResult {
  name: string;
  count: number;
  mae: number;
  max_error: number;
  max_error_case: string;
  per_archetype_mae: Partial<Record<ArchetypeTag, { count: number; mae: number }>>;
  failing_cases: CaseResult[];
}

function loadJsonl(path: string): FixtureCase[] {
  const raw = readFileSync(path, "utf8").trim();
  if (raw.length === 0) return [];
  return raw.split("\n").map((line) => JSON.parse(line) as FixtureCase);
}

function evalFixture(name: string, cases: FixtureCase[]): FixtureResult {
  const results: CaseResult[] = cases.map((c) => {
    const out = score(c.input);
    const actual = out.ai_leverage_score;
    const expected = c.expected_final_als;
    const error = Math.abs(actual - expected);
    const tolerance = c.tolerance?.final_als ?? GATES.MAE_MAX;
    return {
      case_id: c.case_id,
      archetype_tag: c.archetype_tag,
      expected,
      actual,
      error,
      tolerance,
      within_tolerance: error <= tolerance,
    };
  });

  const mae = results.reduce((s, r) => s + r.error, 0) / (results.length || 1);
  let maxErr = 0;
  let maxErrCase = "";
  for (const r of results) {
    if (r.error > maxErr) {
      maxErr = r.error;
      maxErrCase = r.case_id;
    }
  }

  const perArchetype: FixtureResult["per_archetype_mae"] = {};
  const grouped = new Map<ArchetypeTag, CaseResult[]>();
  for (const r of results) {
    const bucket = grouped.get(r.archetype_tag);
    if (bucket === undefined) {
      grouped.set(r.archetype_tag, [r]);
    } else {
      bucket.push(r);
    }
  }
  for (const [tag, group] of grouped) {
    const groupMae = group.reduce((s, r) => s + r.error, 0) / group.length;
    perArchetype[tag] = { count: group.length, mae: groupMae };
  }

  const failing = results.filter((r) => !r.within_tolerance);

  return {
    name,
    count: results.length,
    mae,
    max_error: maxErr,
    max_error_case: maxErrCase,
    per_archetype_mae: perArchetype,
    failing_cases: failing,
  };
}

function fmt(n: number): string {
  return n.toFixed(3);
}

function printResult(r: FixtureResult): void {
  console.log(`\n=== ${r.name} (${r.count} cases) ===`);
  console.log(`MAE:        ${fmt(r.mae)}    (gate ≤ ${GATES.MAE_MAX})`);
  console.log(
    `max|err|:   ${fmt(r.max_error)}    @ ${r.max_error_case}    (gate ≤ ${GATES.MAX_ERROR_MAX})`,
  );
  console.log(`per-archetype MAE:`);
  for (const [tag, stats] of Object.entries(r.per_archetype_mae)) {
    if (!stats) continue;
    const flag = stats.mae > GATES.PER_ARCHETYPE_MAE_MAX ? " ⚠" : "";
    console.log(
      `  ${tag.padEnd(18)} n=${String(stats.count).padStart(3)}  mae=${fmt(stats.mae)}${flag}`,
    );
  }
  if (r.failing_cases.length > 0) {
    console.log(`FAILING (${r.failing_cases.length}):`);
    for (const f of r.failing_cases.slice(0, 10)) {
      console.log(
        `  ${f.case_id.padEnd(24)} ${f.archetype_tag.padEnd(18)} expected=${fmt(f.expected)} actual=${fmt(f.actual)} err=${fmt(f.error)} (tol=${fmt(f.tolerance)})`,
      );
    }
    if (r.failing_cases.length > 10) {
      console.log(`  ... and ${r.failing_cases.length - 10} more`);
    }
  }
}

function gateResult(r: FixtureResult): string[] {
  const failures: string[] = [];
  if (r.mae > GATES.MAE_MAX) {
    failures.push(`${r.name}: MAE ${fmt(r.mae)} > ${GATES.MAE_MAX}`);
  }
  if (r.max_error > GATES.MAX_ERROR_MAX) {
    failures.push(
      `${r.name}: max|err| ${fmt(r.max_error)} > ${GATES.MAX_ERROR_MAX} (case ${r.max_error_case})`,
    );
  }
  for (const [tag, stats] of Object.entries(r.per_archetype_mae)) {
    if (!stats) continue;
    if (stats.mae > GATES.PER_ARCHETYPE_MAE_MAX) {
      failures.push(
        `${r.name}: archetype "${tag}" MAE ${fmt(stats.mae)} > ${GATES.PER_ARCHETYPE_MAE_MAX}`,
      );
    }
  }
  if (r.failing_cases.length > 0) {
    failures.push(`${r.name}: ${r.failing_cases.length} case(s) outside per-case tolerance`);
  }
  return failures;
}

// --- main --------------------------------------------------------------------

const t0 = Date.now();

const fixtures = [
  { name: "archetypes", file: "archetypes.jsonl" },
  { name: "snapshots", file: "snapshots.jsonl" },
  { name: "validation (held-out)", file: "validation.jsonl" },
];

const allFailures: string[] = [];
for (const f of fixtures) {
  const cases = loadJsonl(join(FIXTURE_DIR, f.file));
  if (cases.length === 0) {
    console.log(`\n=== ${f.name} === (0 cases — skipped)`);
    continue;
  }
  const result = evalFixture(f.name, cases);
  printResult(result);
  allFailures.push(...gateResult(result));
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
console.log(`\nelapsed: ${elapsed}s`);

if (elapsed && Number.parseFloat(elapsed) > GATES.RUNTIME_MAX_SEC) {
  allFailures.push(`runtime ${elapsed}s > ${GATES.RUNTIME_MAX_SEC}s`);
}

if (allFailures.length > 0) {
  console.log(`\n❌ ${allFailures.length} gate failure(s):`);
  for (const f of allFailures) console.log(`  - ${f}`);
  process.exit(1);
}

console.log(`\n✓ all gates pass`);
process.exit(0);
