// GitHub-App PR reconciliation via GraphQL search (D-S1-18).
//
// Daily cron fires `reconcilePrs` against the GraphQL `search` API for
// `org:<org> is:pr merged:<sinceDate>..` — 10× cheaper than REST per the
// research loop. Pagination via cursor; if any single page hits the 1000-
// result cap (the hard GraphQL search limit), we re-issue day-partitioned
// queries.
//
// This file does NOT execute the cron — that lives in cron.ts. Here we just
// expose the pure `reconcilePrs` function that takes a token + fetch and
// returns the counts.

import type { GitEventRow } from "../webhooks/gitEventsStore";

export interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export type FetchFn = typeof fetch;

type PrNode = {
  id: string;
  number: number;
  merged: boolean;
  mergedAt: string | null;
  mergeCommit: { oid: string | null } | null;
  repository: { id: string };
};

type SearchResponse = {
  data: {
    search: {
      issueCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: PrNode[];
    };
    rateLimit: { remaining: number; resetAt: string };
  };
};

function toGitEventRow(node: PrNode): GitEventRow {
  return {
    source: "github",
    event_kind: "pull_request.reconciled",
    pr_node_id: node.id,
    repo_id: node.repository.id,
    pr_number: node.number,
    commit_sha: node.mergeCommit?.oid ?? null,
    merged_at: node.mergedAt,
    payload: node,
  };
}

export interface ReconcilePrsInput {
  token: string;
  org: string;
  /** ISO date string, e.g. "2026-04-09" (7 days ago). */
  sinceDate: string;
  fetchFn?: FetchFn;
  upsertRow: (row: GitEventRow) => Promise<{ inserted: boolean }>;
  logger: Logger;
  /** Override GitHub GraphQL endpoint for tests. */
  graphqlUrl?: string;
  /** ISO date (YYYY-MM-DD) for "today" — test override for the day-partition fallback. */
  todayIso?: string;
}

const QUERY = `
  query($q: String!, $cursor: String) {
    search(query: $q, type: ISSUE, first: 100, after: $cursor) {
      issueCount
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          id
          number
          merged
          mergedAt
          mergeCommit { oid }
          repository { id }
        }
      }
    }
    rateLimit { remaining resetAt }
  }
`;

async function runSearch(
  fetchFn: FetchFn,
  graphqlUrl: string,
  token: string,
  q: string,
  cursor: string | null,
): Promise<SearchResponse> {
  const res = await fetchFn(graphqlUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ query: QUERY, variables: { q, cursor } }),
  });
  if (!res.ok) {
    throw new Error(`github-app:graphql-failed:${res.status}`);
  }
  return (await res.json()) as SearchResponse;
}

async function paginate(
  fetchFn: FetchFn,
  graphqlUrl: string,
  token: string,
  q: string,
  upsertRow: (row: GitEventRow) => Promise<{ inserted: boolean }>,
  logger: Logger,
): Promise<{ upserted: number; rateLimitRemaining: number; capped: boolean }> {
  let cursor: string | null = null;
  let upserted = 0;
  let rateLimitRemaining = Number.POSITIVE_INFINITY;
  let capped = false;
  for (let page = 0; page < 10; page++) {
    const resp = await runSearch(fetchFn, graphqlUrl, token, q, cursor);
    const { search, rateLimit } = resp.data;
    rateLimitRemaining = rateLimit.remaining;
    if (rateLimit.remaining < 500) {
      logger.warn(
        { remaining: rateLimit.remaining, resetAt: rateLimit.resetAt },
        "github-app graphql rate-limit low",
      );
    }
    for (const node of search.nodes) {
      await upsertRow(toGitEventRow(node));
      upserted++;
    }
    // 1000-result cap detection: search.issueCount >= 1000 AND we've walked
    // to a page with hasNextPage=true but endCursor nullish — GitHub's
    // search API refuses to paginate beyond 1000.
    if (search.issueCount >= 1000 && (!search.pageInfo.endCursor || !search.pageInfo.hasNextPage)) {
      if (search.issueCount >= 1000) {
        capped = true;
        logger.warn({ issueCount: search.issueCount, q }, "github-app graphql search hit 1000 cap");
      }
      break;
    }
    if (!search.pageInfo.hasNextPage || !search.pageInfo.endCursor) break;
    cursor = search.pageInfo.endCursor;
  }
  return { upserted, rateLimitRemaining, capped };
}

function dayRange(sinceDate: string, todayIso: string): string[] {
  // Inclusive [sinceDate..todayIso] → array of YYYY-MM-DD strings.
  const out: string[] = [];
  const start = new Date(`${sinceDate}T00:00:00Z`);
  const end = new Date(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [sinceDate];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const d = new Date(t);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out.length > 0 ? out : [sinceDate];
}

export async function reconcilePrs(
  input: ReconcilePrsInput,
): Promise<{ upserted: number; rateLimitRemaining: number }> {
  const fetchFn = input.fetchFn ?? fetch;
  const graphqlUrl = input.graphqlUrl ?? "https://api.github.com/graphql";
  const q = `org:${input.org} is:pr merged:>=${input.sinceDate}`;
  const first = await paginate(fetchFn, graphqlUrl, input.token, q, input.upsertRow, input.logger);
  let total = first.upserted;
  let rateLimitRemaining = first.rateLimitRemaining;
  if (first.capped) {
    // M2 fix: day-partition across the FULL [sinceDate..today] window.
    // Previously we only re-ran for `merged:${sinceDate}` (a single day),
    // which on a high-volume org silently dropped 6 of 7 days of PR data.
    const today = input.todayIso ?? new Date().toISOString().slice(0, 10);
    const days = dayRange(input.sinceDate, today);
    input.logger.warn(
      { org: input.org, days: days.length },
      "github-app: day-partitioning fallback",
    );
    for (const day of days) {
      const dayQ = `org:${input.org} is:pr merged:${day}`;
      const next = await paginate(
        fetchFn,
        graphqlUrl,
        input.token,
        dayQ,
        input.upsertRow,
        input.logger,
      );
      total += next.upserted;
      rateLimitRemaining = next.rateLimitRemaining;
    }
  }
  return { upserted: total, rateLimitRemaining };
}
