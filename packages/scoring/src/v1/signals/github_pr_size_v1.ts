/**
 * `github_pr_size_v1` — secondary denominator input to `efficiency_v1`
 * (PRD §12.1, D46).
 *
 * This module does NOT replace `accepted_and_retained_edits_per_dollar` — it
 * computes the LOC side with the D46 guard rails so downstream efficiency
 * math has a clean, gameability-hardened denominator.
 *
 * Guard rails (all enforced here):
 *   - Strip files matching `linguist_generated_globs` before counting LOC
 *     (caller supplies the pre-parsed `.gitattributes linguist-generated`
 *     globset — production wiring in G3; fixture-driven in G2).
 *   - PRs with <10 LOC of counted work are excluded entirely (can't
 *     meaningfully rank size when the PR is a typo fix).
 *   - Winsorize the per-PR LOC distribution at p5/p95 before summing — one
 *     giant generated-yaml bump shouldn't dominate the sum.
 *   - Emit `test_loc` / `prod_loc` companion metrics so reviewers can see
 *     test-to-prod ratio next to the aggregate size.
 *
 * Pure: deterministic for identical input. No I/O, no random, no mutation
 * of the input arrays.
 */

export interface PrFile {
  path: string;
  additions: number;
  deletions: number;
  is_test: boolean;
}

export interface PrSizeInputPr {
  pr_number: number;
  additions: number;
  deletions: number;
  files: PrFile[];
}

export interface PrSizeInput {
  prs: PrSizeInputPr[];
  /**
   * Glob patterns (simple `*` / `**` / suffix / prefix) identifying files
   * that should be excluded per `.gitattributes linguist-generated`. In G2
   * this is populated from a dev fixture; G3 wires a real per-repo resolver.
   */
  linguist_generated_globs: string[];
}

export interface IncludedPr {
  pr_number: number;
  loc: number;
  prod_loc: number;
  test_loc: number;
  winsorized_loc: number;
}

export interface PrSizeResult {
  included_prs: IncludedPr[];
  excluded_count: number;
  /** Sum of winsorized LOC across included PRs. */
  winsorized_loc_sum: number;
  prod_loc: number;
  test_loc: number;
  /** test_loc / max(prod_loc, 1). */
  test_to_prod_ratio: number;
  p5: number;
  p95: number;
}

const MIN_PR_LOC = 10;

/**
 * Minimal glob → regex converter for the subset used in `.gitattributes`.
 * Supports `**`, `*`, literal segments. Per git's pathspec rules, a pattern
 * with no `/` matches the BASENAME at any depth (gitignore-style); a
 * pattern containing `/` is anchored to the repo root.
 */
function globToRegex(glob: string): RegExp {
  const trimmed = glob.trim();
  if (trimmed.length === 0) return /^(?!)$/;
  const anchored = trimmed.includes("/");
  let out = anchored ? "^" : "^(?:.*/)?";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "*") {
      if (trimmed[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch !== undefined && /[.+^${}()|[\]\\]/.test(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch ?? "";
    }
  }
  out += "$";
  return new RegExp(out);
}

function isLinguistGenerated(path: string, globs: RegExp[]): boolean {
  return globs.some((re) => re.test(path));
}

function percentileValueType7(sortedAsc: number[], pct: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  const first = sortedAsc[0] ?? 0;
  if (n === 1) return first;
  const rank = (pct / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = sortedAsc[lo] ?? first;
  const b = sortedAsc[hi] ?? a;
  if (lo === hi) return a;
  const frac = rank - lo;
  return a * (1 - frac) + b * frac;
}

export function computePrSize(input: PrSizeInput): PrSizeResult {
  const globs = input.linguist_generated_globs.map(globToRegex);

  // Step 1 — strip generated files & sum per-PR LOC / split test vs prod.
  type PrWithLoc = IncludedPr & { _raw: number };
  const perPr: PrWithLoc[] = [];
  let excluded_count = 0;
  for (const pr of input.prs) {
    let loc = 0;
    let prod_loc = 0;
    let test_loc = 0;
    for (const f of pr.files) {
      if (isLinguistGenerated(f.path, globs)) continue;
      const fileLoc = f.additions + f.deletions;
      loc += fileLoc;
      if (f.is_test) test_loc += fileLoc;
      else prod_loc += fileLoc;
    }
    if (loc < MIN_PR_LOC) {
      excluded_count++;
      continue;
    }
    perPr.push({
      pr_number: pr.pr_number,
      loc,
      prod_loc,
      test_loc,
      winsorized_loc: 0,
      _raw: loc,
    });
  }

  // Step 2 — winsorize the per-PR LOC distribution at p5/p95.
  const sortedLoc = perPr.map((p) => p.loc).sort((a, b) => a - b);
  const p5 = percentileValueType7(sortedLoc, 5);
  const p95 = percentileValueType7(sortedLoc, 95);
  for (const p of perPr) {
    p.winsorized_loc = Math.max(p5, Math.min(p95, p.loc));
  }

  const winsorized_loc_sum = perPr.reduce((s, p) => s + p.winsorized_loc, 0);
  const prod_loc = perPr.reduce((s, p) => s + p.prod_loc, 0);
  const test_loc = perPr.reduce((s, p) => s + p.test_loc, 0);
  const test_to_prod_ratio = test_loc / Math.max(prod_loc, 1);

  return {
    included_prs: perPr.map(({ pr_number, loc, prod_loc: pl, test_loc: tl, winsorized_loc }) => ({
      pr_number,
      loc,
      prod_loc: pl,
      test_loc: tl,
      winsorized_loc,
    })),
    excluded_count,
    winsorized_loc_sum,
    prod_loc,
    test_loc,
    test_to_prod_ratio,
    p5,
    p95,
  };
}
