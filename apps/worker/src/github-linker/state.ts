// Pure-function linker state computer (PRD §10 D53).
//
// Contract:
//   State = f(
//     installations.active,
//     repos.tracking_state + tracking_mode,
//     session.enrichment(session_id),
//     pull_requests ∩ (head_sha|merge_sha) ∩ commit_shas(session),
//     deployments   ∩ sha ∩ commit_shas(session),
//     aliases.applicable,
//     tombstones.force_push
//   )
//
// Event order MUST NOT affect output. The 1000-ordering commutativity test
// asserts this.
//
// D57 forbidden-field rule: `evidence` jsonb in session_repo_links must
// contain ONLY hashes (as hex strings) + structural counts + booleans. This
// module is the write-time gatekeeper — see `assertEvidenceSafe`.

import { canonicalJson, canonicalSha256 } from "./canonical";
import { authoritativeHash, defaultTenantSalt, repoIdHash } from "./hash";

/** Minimum set of fields for an active installation. */
export interface Installation {
  installation_id: string;
  status: "active" | "suspended" | "revoked" | "reconnecting";
}

/** Tracked repo row. `stored_repo_id_hash` may be a placeholder string. */
export interface Repo {
  provider_repo_id: string;
  tracking_state: "inherit" | "included" | "excluded";
  stored_repo_id_hash?: Buffer | Uint8Array | string;
}

export type TrackingMode = "all" | "selected";

/** Session enrichment: what the session claims to have touched. */
export interface SessionEnrichment {
  session_id: string;
  /**
   * Direct-repo hints: provider_repo_id strings the session mentioned
   * (e.g. `repo` attribute on events).
   */
  direct_provider_repo_ids: string[];
  commit_shas: string[];
  pr_numbers: number[];
  /**
   * G3 — ISO-8601 timestamps per commit_sha, same order. Optional for
   * back-compat: when absent OR empty, timestamp-range tombstones have no
   * effect (only SHA-list tombstones apply). Same length as `commit_shas`
   * when present.
   */
  commit_timestamps?: string[];
}

export interface PullRequest {
  provider_repo_id: string;
  pr_number: number;
  head_sha: string;
  merge_commit_sha: string | null;
  state: "open" | "closed" | "merged";
  from_fork: boolean;
  title_hash: Buffer;
  author_login_hash: Buffer;
  additions: number;
  deletions: number;
  changed_files: number;
}

export interface Deployment {
  provider_repo_id: string;
  deployment_id: string;
  sha: string;
  environment: string;
  status: string;
}

export interface Alias {
  old_hash: Buffer;
  new_hash: Buffer;
  reason: "rename" | "transfer" | "salt_rotation" | "provider_change";
}

/**
 * Force-push tombstone (G3, D53 pure-function extension) — SHAs AND/OR
 * commit-timestamp ranges that must be excluded from link evidence because
 * they were rewound out of history by a forced push.
 *
 * G1 shipped the flat SHA list. G3 extends to 30-minute windows keyed on
 * the force-push timestamp: `[force_push_at - 30min, force_push_at]`. A
 * session's commit whose `commit_timestamp` falls inside any range is
 * excluded from eligibility, mirroring the behavior for SHA exclusion.
 *
 * Both shapes coexist — callers can pass flat SHAs (old) and/or ranges
 * (new). Commutativity is preserved because ranges are sorted and
 * de-duped before hashing in `canonicalInputSet`.
 */
export interface ForcePushTombstone {
  provider_repo_id: string;
  excluded_shas: string[];
  /**
   * 30-min windows during which rewound commits were published. Format:
   * ISO-8601 timestamps, `range_end` exclusive. Empty array permitted for
   * back-compat with G1-shaped inputs.
   */
  excluded_ranges?: Array<{ range_start: string; range_end: string }>;
}

export interface LinkerInputs {
  tenant_id: string;
  tenant_mode: TrackingMode;
  installations: Installation[];
  repos: Repo[];
  session: SessionEnrichment;
  pull_requests: PullRequest[];
  deployments: Deployment[];
  aliases: Alias[];
  tombstones: ForcePushTombstone[];
  /**
   * Snapshot of installation lifecycle for the session's repos — this
   * session's effective installation. `installation_status` lets the
   * synthesized `installation.suspend` path mark links `stale_at = now()`
   * without hard-deleting.
   */
  installation_status?: Installation["status"];
  /** Per-tenant salt for authoritative repo_id_hash. */
  tenant_salt?: Buffer;
}

export interface SessionRepoLinkRow {
  tenant_id: string;
  session_id: string;
  repo_id_hash: Buffer;
  match_reason: "direct_repo" | "commit_link" | "pr_link" | "deployment_link";
  provider_repo_id: string;
  evidence: Record<string, unknown>;
  confidence: number;
  inputs_sha256: Buffer;
  computed_at: string;
  /** ISO string when stale; null otherwise. */
  stale_at: string | null;
}

export interface SessionRepoEligibilityRow {
  tenant_id: string;
  session_id: string;
  effective_at: string;
  eligibility_reasons: Record<string, unknown>;
  eligible: boolean;
  inputs_sha256: Buffer;
}

export interface LinkerState {
  links: SessionRepoLinkRow[];
  eligibility: SessionRepoEligibilityRow;
  inputs_sha256: Buffer;
}

/** Nominal `computed_at` / `effective_at` — callers override in tests. */
export interface StateClock {
  now(): string;
}

export const SYSTEM_CLOCK: StateClock = { now: () => new Date().toISOString() };

/**
 * Compute the linker state for a session. Pure — no side effects, no I/O.
 *
 * Commutativity gate: sort every input collection by its primary key tuple
 * before hashing, so arbitrary caller ordering produces identical
 * `inputs_sha256`.
 */
export function computeLinkerState(
  inputs: LinkerInputs,
  clock: StateClock = SYSTEM_CLOCK,
): LinkerState {
  const salt = inputs.tenant_salt ?? defaultTenantSalt(inputs.tenant_id);
  const activeInstallations = sortBy(
    inputs.installations.filter((i) => i.status === "active"),
    (i) => i.installation_id,
  );
  const repos = sortBy(inputs.repos, (r) => r.provider_repo_id);
  const reposByProvider = new Map<string, Repo>();
  for (const r of repos) reposByProvider.set(r.provider_repo_id, r);

  // Tombstone SHAs per provider_repo_id: set lookup.
  const tombstoneShas = new Map<string, Set<string>>();
  for (const t of inputs.tombstones) {
    const s = tombstoneShas.get(t.provider_repo_id) ?? new Set<string>();
    for (const sha of t.excluded_shas) s.add(sha);
    tombstoneShas.set(t.provider_repo_id, s);
  }

  // G3: Build per-commit_sha exclusion based on commit_timestamp ranges. For
  // each tombstone-range that covers a commit's timestamp, add that commit
  // to its repo's tombstone set. This closes the race with concurrent
  // session enrichment (PRD §17 risk #8): a session whose commit arrives
  // DURING a force-push window gets excluded identically regardless of
  // event ordering.
  const hasTimestamps =
    Array.isArray(inputs.session.commit_timestamps) &&
    inputs.session.commit_timestamps.length === inputs.session.commit_shas.length;
  for (const t of inputs.tombstones) {
    const ranges = t.excluded_ranges ?? [];
    if (ranges.length === 0 || !hasTimestamps) continue;
    const set = tombstoneShas.get(t.provider_repo_id) ?? new Set<string>();
    for (let i = 0; i < inputs.session.commit_shas.length; i++) {
      const sha = inputs.session.commit_shas[i];
      // biome-ignore lint/style/noNonNullAssertion: guarded above.
      const ts = inputs.session.commit_timestamps![i];
      if (!sha || !ts) continue;
      const ms = Date.parse(ts);
      if (Number.isNaN(ms)) continue;
      for (const r of ranges) {
        const startMs = Date.parse(r.range_start);
        const endMs = Date.parse(r.range_end);
        if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue;
        if (ms >= startMs && ms < endMs) {
          set.add(sha);
          break;
        }
      }
    }
    tombstoneShas.set(t.provider_repo_id, set);
  }

  // Session SHAs with tombstones excluded, per provider_repo_id filter we'll
  // apply when we check each intersection.
  const sessionShaSet = new Set<string>(inputs.session.commit_shas);
  const sessionPrSet = new Set<number>(inputs.session.pr_numbers);
  const directRepoSet = new Set<string>(inputs.session.direct_provider_repo_ids);

  // Installation-lifecycle: if the session's governing installation is
  // non-active, we don't write new links — we flag `stale` on whatever we
  // would have written. D56/§10 "Installation-lifecycle state rule".
  const stale = inputs.installation_status !== undefined && inputs.installation_status !== "active";

  type Candidate = Omit<SessionRepoLinkRow, "inputs_sha256">;
  const candidates: Candidate[] = [];

  // 1. direct_repo: session enrichment names this provider_repo_id.
  for (const providerRepoId of sortStrings([...directRepoSet])) {
    const repo = reposByProvider.get(providerRepoId);
    if (!repo) continue; // session claimed a repo we don't track
    const hash = repoIdHashFor(repo, inputs.tenant_id, salt);
    candidates.push({
      tenant_id: inputs.tenant_id,
      session_id: inputs.session.session_id,
      repo_id_hash: hash,
      match_reason: "direct_repo",
      provider_repo_id: providerRepoId,
      evidence: { source: "direct_repo" },
      confidence: 100,
      computed_at: clock.now(),
      stale_at: stale ? clock.now() : null,
    });
  }

  // 2. commit_link: every PR/repo/deployment SHA that matches a session SHA,
  // minus tombstoned SHAs.
  for (const pr of sortBy(inputs.pull_requests, (p) => `${p.provider_repo_id}|${p.pr_number}`)) {
    const repo = reposByProvider.get(pr.provider_repo_id);
    if (!repo) continue;
    const excluded = tombstoneShas.get(pr.provider_repo_id) ?? new Set<string>();
    const matchedShas: string[] = [];
    if (sessionShaSet.has(pr.head_sha) && !excluded.has(pr.head_sha)) matchedShas.push(pr.head_sha);
    if (
      pr.merge_commit_sha &&
      sessionShaSet.has(pr.merge_commit_sha) &&
      !excluded.has(pr.merge_commit_sha)
    )
      matchedShas.push(pr.merge_commit_sha);
    const hash = repoIdHashFor(repo, inputs.tenant_id, salt);
    if (matchedShas.length > 0) {
      candidates.push({
        tenant_id: inputs.tenant_id,
        session_id: inputs.session.session_id,
        repo_id_hash: hash,
        match_reason: "commit_link",
        provider_repo_id: pr.provider_repo_id,
        evidence: {
          source: "pr_commit_intersection",
          pr_number: pr.pr_number,
          matched_sha_count: matchedShas.length,
          title_hash_hex: pr.title_hash.toString("hex"),
          author_login_hash_hex: pr.author_login_hash.toString("hex"),
        },
        confidence: 90,
        computed_at: clock.now(),
        stale_at: stale ? clock.now() : null,
      });
    }

    // 2b. pr_link: session's pr_numbers intersect.
    if (sessionPrSet.has(pr.pr_number)) {
      candidates.push({
        tenant_id: inputs.tenant_id,
        session_id: inputs.session.session_id,
        repo_id_hash: hash,
        match_reason: "pr_link",
        provider_repo_id: pr.provider_repo_id,
        evidence: {
          source: "session_pr_number",
          pr_number: pr.pr_number,
          state: pr.state,
          from_fork: pr.from_fork,
          additions: pr.additions,
          deletions: pr.deletions,
          changed_files: pr.changed_files,
        },
        confidence: 85,
        computed_at: clock.now(),
        stale_at: stale ? clock.now() : null,
      });
    }
  }

  // 3. deployment_link: deployment.sha ∩ session.commit_shas, minus tombstones.
  for (const dep of sortBy(inputs.deployments, (d) => `${d.provider_repo_id}|${d.deployment_id}`)) {
    const repo = reposByProvider.get(dep.provider_repo_id);
    if (!repo) continue;
    const excluded = tombstoneShas.get(dep.provider_repo_id) ?? new Set<string>();
    if (!sessionShaSet.has(dep.sha) || excluded.has(dep.sha)) continue;
    const hash = repoIdHashFor(repo, inputs.tenant_id, salt);
    candidates.push({
      tenant_id: inputs.tenant_id,
      session_id: inputs.session.session_id,
      repo_id_hash: hash,
      match_reason: "deployment_link",
      provider_repo_id: dep.provider_repo_id,
      evidence: {
        source: "deployment_sha_intersection",
        deployment_id: dep.deployment_id,
        environment: dep.environment,
        status: dep.status,
      },
      confidence: 80,
      computed_at: clock.now(),
      stale_at: stale ? clock.now() : null,
    });
  }

  // Dedupe by (tenant_id, session_id, repo_id_hash, match_reason) — primary key.
  const deduped = dedupeByKey(candidates, (c) =>
    [c.tenant_id, c.session_id, c.repo_id_hash.toString("hex"), c.match_reason].join("|"),
  );
  // Final sort (by PK tuple) for deterministic output ordering.
  const sortedCandidates = sortBy(deduped, (c) =>
    [c.tenant_id, c.session_id, c.repo_id_hash.toString("hex"), c.match_reason].join("|"),
  );

  // Hash the full input set (pre-sorted) → inputs_sha256.
  const inputsSha256 = canonicalSha256(
    canonicalInputSet(inputs, sortedCandidates) as unknown as import("./canonical").JsonInput,
  );
  const links: SessionRepoLinkRow[] = sortedCandidates.map((c) => ({
    ...c,
    inputs_sha256: inputsSha256,
  }));

  // Eligibility derived post-hoc, same hash.
  const { eligible, reasons } = resolveEligibility(
    {
      links,
      inputs_sha256: inputsSha256,
      // eligibility doesn't need the repeat of inputs_sha256 on eligibility yet;
      // we populate below once we have the row.
      eligibility: {
        tenant_id: inputs.tenant_id,
        session_id: inputs.session.session_id,
        effective_at: clock.now(),
        eligibility_reasons: {},
        eligible: false,
        inputs_sha256: inputsSha256,
      },
    },
    inputs.tenant_mode,
    repos,
    inputs.session,
  );

  const eligibility: SessionRepoEligibilityRow = {
    tenant_id: inputs.tenant_id,
    session_id: inputs.session.session_id,
    effective_at: clock.now(),
    eligibility_reasons: reasons,
    eligible,
    inputs_sha256: inputsSha256,
  };

  return { links, eligibility, inputs_sha256: inputsSha256 };
}

/** Pure eligibility resolver (PRD §13 3-mode + branch-only). */
export function resolveEligibility(
  state: Pick<LinkerState, "links"> & {
    eligibility: SessionRepoEligibilityRow;
    inputs_sha256: Buffer;
  },
  tenantMode: TrackingMode,
  repos: Repo[],
  session: SessionEnrichment,
): { eligible: boolean; reasons: Record<string, unknown> } {
  const trackingByRepo = new Map<string, Repo>();
  for (const r of repos) trackingByRepo.set(r.provider_repo_id, r);

  // Effective tracking for a given repo (resolves 'inherit').
  const effective = (r: Repo): "included" | "excluded" => {
    if (r.tracking_state === "included") return "included";
    if (r.tracking_state === "excluded") return "excluded";
    // 'inherit' → tenant mode
    return tenantMode === "all" ? "included" : "excluded";
  };

  // Branch-only sessions: no commit_sha overlap, no pr_numbers, no direct
  // repo hints. Not eligible regardless of mode.
  const hasAnyEvidence = state.links.length > 0;
  if (!hasAnyEvidence) {
    return {
      eligible: false,
      reasons: {
        mode: tenantMode,
        matched_links: 0,
        branch_only_session:
          session.commit_shas.length === 0 &&
          session.pr_numbers.length === 0 &&
          session.direct_provider_repo_ids.length === 0,
      },
    };
  }

  // Inspect each linked repo's effective tracking_state.
  const perRepo: Array<{
    provider_repo_id: string;
    effective_tracking: "included" | "excluded" | "unknown";
  }> = [];
  for (const link of state.links) {
    const r = trackingByRepo.get(link.provider_repo_id);
    perRepo.push({
      provider_repo_id: link.provider_repo_id,
      effective_tracking: r ? effective(r) : "unknown",
    });
  }
  const distinctRepoTracking = sortBy(
    dedupeByKey(perRepo, (p) => p.provider_repo_id),
    (p) => p.provider_repo_id,
  );

  if (tenantMode === "all") {
    // eligible if ANY link is to a repo with effective_tracking !== 'excluded'.
    const eligible = distinctRepoTracking.some((p) => p.effective_tracking !== "excluded");
    return {
      eligible,
      reasons: { mode: "all", repos: distinctRepoTracking },
    };
  }
  // selected mode: eligible only if some link is 'included' explicitly.
  const eligible = distinctRepoTracking.some((p) => p.effective_tracking === "included");
  return {
    eligible,
    reasons: { mode: "selected", repos: distinctRepoTracking },
  };
}

/** Pre-compute authoritative hash, handling placeholder rewrite. */
function repoIdHashFor(repo: Repo, tenantId: string, salt: Buffer): Buffer {
  if (repo.stored_repo_id_hash !== undefined) {
    return authoritativeHash(repo.stored_repo_id_hash, tenantId, repo.provider_repo_id, salt);
  }
  return repoIdHash(salt, repo.provider_repo_id);
}

/** Canonical serialization of the full input set for `inputs_sha256`. */
function canonicalInputSet(inputs: LinkerInputs, sortedCandidates: unknown[]): unknown {
  const sortedInstallations = sortBy(
    inputs.installations,
    (i) => `${i.installation_id}|${i.status}`,
  );
  const sortedRepos = sortBy(
    inputs.repos.map((r) => ({
      provider_repo_id: r.provider_repo_id,
      tracking_state: r.tracking_state,
    })),
    (r) => r.provider_repo_id,
  );
  // Sort commit_shas with their paired timestamps so both sides travel
  // together — otherwise a permuted commit-order would break commutativity
  // when a timestamp-range tombstone is present.
  const commits = inputs.session.commit_shas.map((sha, i) => ({
    sha,
    ts:
      Array.isArray(inputs.session.commit_timestamps) &&
      inputs.session.commit_timestamps.length === inputs.session.commit_shas.length
        ? (inputs.session.commit_timestamps[i] ?? null)
        : null,
  }));
  const sortedCommits = [...commits].sort((a, b) => (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0));
  const sortedSession = {
    session_id: inputs.session.session_id,
    direct_provider_repo_ids: [...inputs.session.direct_provider_repo_ids].sort(),
    commit_shas: sortedCommits.map((c) => c.sha),
    commit_timestamps: sortedCommits.map((c) => c.ts),
    pr_numbers: [...inputs.session.pr_numbers].sort((a, b) => a - b),
  };
  const sortedPrs = sortBy(
    inputs.pull_requests.map((p) => ({
      provider_repo_id: p.provider_repo_id,
      pr_number: p.pr_number,
      head_sha: p.head_sha,
      merge_commit_sha: p.merge_commit_sha,
      state: p.state,
      from_fork: p.from_fork,
      title_hash_hex: p.title_hash.toString("hex"),
      author_login_hash_hex: p.author_login_hash.toString("hex"),
      additions: p.additions,
      deletions: p.deletions,
      changed_files: p.changed_files,
    })),
    (p) => `${p.provider_repo_id}|${p.pr_number}`,
  );
  const sortedDeployments = sortBy(
    inputs.deployments.map((d) => ({
      provider_repo_id: d.provider_repo_id,
      deployment_id: d.deployment_id,
      sha: d.sha,
      environment: d.environment,
      status: d.status,
    })),
    (d) => `${d.provider_repo_id}|${d.deployment_id}`,
  );
  const sortedAliases = sortBy(
    inputs.aliases.map((a) => ({
      old_hash_hex: a.old_hash.toString("hex"),
      new_hash_hex: a.new_hash.toString("hex"),
      reason: a.reason,
    })),
    (a) => `${a.old_hash_hex}|${a.new_hash_hex}|${a.reason}`,
  );
  const sortedTombstones = sortBy(
    inputs.tombstones.map((t) => ({
      provider_repo_id: t.provider_repo_id,
      excluded_shas: [...t.excluded_shas].sort(),
      excluded_ranges: [...(t.excluded_ranges ?? [])]
        .map((r) => ({ range_start: r.range_start, range_end: r.range_end }))
        .sort((a, b) =>
          a.range_start === b.range_start
            ? a.range_end < b.range_end
              ? -1
              : a.range_end > b.range_end
                ? 1
                : 0
            : a.range_start < b.range_start
              ? -1
              : 1,
        ),
    })),
    (t) => t.provider_repo_id,
  );

  return {
    tenant_id: inputs.tenant_id,
    tenant_mode: inputs.tenant_mode,
    installation_status: inputs.installation_status ?? null,
    installations_active: sortedInstallations.filter((i) => i.status === "active"),
    repos: sortedRepos,
    session: sortedSession,
    pull_requests: sortedPrs,
    deployments: sortedDeployments,
    aliases: sortedAliases,
    tombstones: sortedTombstones,
    candidates: sortedCandidates,
  };
}

/**
 * Extend the forbidden-field server-side validator to include the linker's
 * evidence jsonb. Throws if the evidence object contains any top-level field
 * name on the D57 banlist. Numeric/hex hashes are allowed; anything whose
 * field name matches `/title|message|body|login|email|file|path|diff|prompt/i`
 * is rejected unless suffixed with `_hash`, `_hex`, or `_count`.
 *
 * NOT a crypto defence — the producer already shapes payloads. This is a
 * compile-time-of-record guard for any new match_reason added later.
 */
export function assertEvidenceSafe(evidence: Record<string, unknown>): void {
  const banned = /title|message|body|login|email|file|path|diff|prompt/i;
  for (const [key, value] of Object.entries(evidence)) {
    if (banned.test(key)) {
      if (/_hash|_hex|_count/i.test(key)) continue;
      throw new Error(`forbidden evidence field: ${key}`);
    }
    if (typeof value === "string" && value.length > 256) {
      throw new Error(`evidence field "${key}" exceeds 256-char budget (got ${value.length})`);
    }
  }
}

// --- small utils ----------------------------------------------------------

function sortBy<T>(arr: T[], key: (v: T) => string): T[] {
  return [...arr].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function sortStrings(arr: string[]): string[] {
  return [...arr].sort();
}

function dedupeByKey<T>(arr: T[], key: (v: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of arr) {
    const k = key(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

// silence unused-canonicalJson warning in non-test builds
void canonicalJson;
