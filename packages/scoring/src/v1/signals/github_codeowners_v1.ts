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
 * D47 contribution-earned override — interface ACCEPTS
 * `ic_commit_share_by_path` so the G3 resolver can elevate an IC whose
 * last-90d commit share on a path exceeds 30% to "owner" for that path.
 * G2 implementation uses STATIC rules only and flips
 * `contribution_earned_override_pending` when the input suggests an
 * override WOULD be granted once G3 lands — keeps the CORE logic pure and
 * avoids back-dooring a behavior change mid-sprint.
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
  /** D47: true when a ≥30% commit-share path was observed — G3 will honor. */
  contribution_earned_override_pending: boolean;
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

  // D47 override detection — flag any path that would qualify.
  let contribution_earned_override_pending = false;
  for (const share of Object.values(input.ic_commit_share_by_path)) {
    if (share >= D47_CONTRIBUTION_OVERRIDE_THRESHOLD) {
      contribution_earned_override_pending = true;
      break;
    }
  }

  return {
    owner_teams: owners,
    codeowner_domain,
    contribution_earned_override_pending,
  };
}
