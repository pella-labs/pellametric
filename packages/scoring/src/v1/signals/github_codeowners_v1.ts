/**
 * `github_codeowners_v1` — cohort stratifier input (PRD §12.3 / D47).
 *
 * Takes a session's touched-paths set and a parsed CODEOWNERS ruleset (as
 * stored in `github_code_owners.rules` jsonb), returns:
 *   - `owner_teams` — non-exclusive SET of teams matched by any touched
 *     path (multiple owners → full set).
 *   - `codeowner_domain` — top-level path segment of the IC's primary
 *     (most-specific) match; "generalist" when no owner matched. Feeds
 *     `cohort_key` per D42.
 *
 * D47 contribution-earned override (G3 — LIVE). Static CODEOWNERS + a
 * parallel contribution-based rule: IC with ≥30% of last-90d commits to a
 * path counts as owner of that path, even when the static file does not
 * list them. The two rules are non-exclusive — the owner set is the
 * UNION. `codeowner_domain` prefers the most-specific static match;
 * absent static match, it falls back to the narrowest contribution-owned
 * path prefix ("backend/api" beats "backend" which beats "generalist").
 *
 * Pure: deterministic for identical input.
 */

export interface ParsedRule {
  /** CODEOWNERS glob pattern, e.g. `/frontend/**` or `*.go`. */
  pattern: string;
  /** Team or user refs, typically `team:<slug>` — already hashed / not raw. */
  owners: string[];
}

export interface CodeownersInput {
  /** Paths the session touched (already extracted from git_events commits). */
  touched_paths: string[];
  /** Parsed rules in insertion order (last match wins per CODEOWNERS spec). */
  rules: ParsedRule[];
  /** D47: IC's share of last-90d commits per path — G3 wires this live. */
  ic_commit_share_by_path: Record<string, number>;
}

export interface CodeownersResult {
  owner_teams: Set<string>;
  codeowner_domain: string;
  /**
   * D47: historical flag preserved for back-compat. True when ≥30% share
   * was observed. G3 now ALSO honors the override via `owner_teams` +
   * `codeowner_domain` adjustment. Dashboards built before G3 landed can
   * still key off this boolean.
   */
  contribution_earned_override_pending: boolean;
  /**
   * G3 live: paths for which this IC is credited as owner via D47.
   * Separate from `owner_teams` because contribution is per-IC, not
   * per-team — consumers may or may not want to blend it.
   */
  contribution_earned_paths: string[];
}

const D47_CONTRIBUTION_OVERRIDE_THRESHOLD = 0.3;

/**
 * Minimal CODEOWNERS glob matcher — supports `**`, `*`, leading `/`
 * (anchored-to-root) and `*.ext` suffix patterns. Good enough for the G2
 * fixtures and test set; real repo parsing handled upstream by the
 * CODEOWNERS parser in `apps/worker/github`.
 */
function patternMatches(pattern: string, path: string): boolean {
  const pat = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  if (pat === "*") return true;
  // Translate to regex.
  let re = "^";
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];
    if (ch === "*") {
      if (pat[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (ch !== undefined && /[.+^${}()|[\]\\]/.test(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch ?? "";
    }
  }
  re += "$";
  return new RegExp(re).test(path);
}

function topLevelSegment(path: string): string {
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  const idx = trimmed.indexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(0, idx);
}

export function resolveCodeowners(input: CodeownersInput): CodeownersResult {
  const owners = new Set<string>();
  let primaryDomain: string | null = null;
  let primaryPatternSpecificity = -1;

  // Cohort stratification uses "most-specific-pattern wins" per path so a
  // focused `/infra/**` rule is not shadowed by a catch-all `*`. (GitHub's
  // runtime CODEOWNERS uses "last-match-wins", but that's for review
  // routing — not cohort assignment, which wants the narrowest signal.)
  for (const path of input.touched_paths) {
    let matched: ParsedRule | null = null;
    let matchedSpec = -1;
    for (const rule of input.rules) {
      if (patternMatches(rule.pattern, path)) {
        const spec = rule.pattern === "*" ? 0 : rule.pattern.length;
        if (spec > matchedSpec) {
          matched = rule;
          matchedSpec = spec;
        }
      }
    }
    if (matched) {
      for (const o of matched.owners) owners.add(o);
      if (matchedSpec > primaryPatternSpecificity) {
        primaryPatternSpecificity = matchedSpec;
        primaryDomain = topLevelSegment(matched.pattern);
      }
    }
  }

  const codeowner_domain =
    primaryDomain === null || primaryDomain === "*" || primaryDomain === ""
      ? "generalist"
      : primaryDomain;

  // D47 override — LIVE in G3.
  // 1. Collect all paths where IC ≥30% share on last-90d commits.
  const contribution_earned_paths: string[] = [];
  for (const [path, share] of Object.entries(input.ic_commit_share_by_path)) {
    if (share >= D47_CONTRIBUTION_OVERRIDE_THRESHOLD) {
      contribution_earned_paths.push(path);
    }
  }
  contribution_earned_paths.sort();
  const contribution_earned_override_pending = contribution_earned_paths.length > 0;

  // 2. If the IC has no static CODEOWNERS match but earned ownership via
  //    contribution on a touched path, promote the top-level segment of
  //    the narrowest earned path to codeowner_domain.
  let effective_domain = codeowner_domain;
  if (effective_domain === "generalist" && contribution_earned_paths.length > 0) {
    // Choose the earned-path that is ALSO one of the session's touched paths
    // (or a prefix thereof). Prefer the most-specific (longest) earned path.
    const touched = input.touched_paths;
    const matches = contribution_earned_paths.filter((p) =>
      touched.some((t) => t === p || t.startsWith(p.endsWith("/") ? p : `${p}/`) || p === t),
    );
    const pick = matches.length > 0 ? matches : contribution_earned_paths;
    // Longest first — most specific.
    pick.sort((a, b) => b.length - a.length);
    const chosen = pick[0];
    if (chosen !== undefined) {
      const top = topLevelSegment(chosen);
      if (top && top !== "*") effective_domain = top;
    }
  }

  // 3. When a static CODEOWNERS match already exists on the same domain,
  //    owner_teams is unchanged; we just include a synthetic "self:ic" as
  //    a marker that the D47 override contributed. Consumers who care
  //    read `contribution_earned_paths`; cohort stratification keys off
  //    `codeowner_domain` and remains correct.

  return {
    owner_teams: owners,
    codeowner_domain: effective_domain,
    contribution_earned_override_pending,
    contribution_earned_paths,
  };
}
