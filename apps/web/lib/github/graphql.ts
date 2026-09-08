// Hot-path §4.5 — GraphQL PR + commits + files batch (verbatim).

export const PR_HYDRATION_QUERY = /* GraphQL */ `
  query PrHydration($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        number
        title
        author { login }
        mergedAt
        state
        baseRefName
        headRefName
        mergeCommit { oid }
        commits(first: 100) {
          totalCount
          nodes {
            commit {
              oid
              message
              authoredDate
              additions
              deletions
              author { user { login } email name }
              committer { email user { login } }
            }
          }
        }
        files(first: 100) {
          totalCount
          nodes { path additions deletions changeType }
        }
      }
    }
  }
`;

export type PrHydrationResponse = {
  repository: {
    pullRequest: {
      number: number;
      title: string | null;
      author: { login: string } | null;
      mergedAt: string | null;
      state: "OPEN" | "CLOSED" | "MERGED";
      baseRefName: string;
      headRefName: string;
      mergeCommit: { oid: string } | null;
      commits: {
        totalCount: number;
        nodes: Array<{
          commit: {
            oid: string;
            message: string;
            authoredDate: string;
            additions: number;
            deletions: number;
            author: { user: { login: string } | null; email: string | null; name: string | null } | null;
            committer: { email: string | null; user: { login: string } | null } | null;
          };
        }>;
      };
      files: {
        totalCount: number;
        nodes: Array<{ path: string; additions: number; deletions: number; changeType: string }>;
      };
    } | null;
  } | null;
};

type BatchRef = { orgSlug: string; repo: string; prNumber: number };

/**
 * Batches up to 10 PRs in a single GraphQL request using aliased fields.
 */
export async function executeBatchHydration(
  refs: BatchRef[],
  installationToken: string,
): Promise<Array<PrHydrationResponse["repository"] | null>> {
  if (refs.length === 0) return [];
  if (refs.length > 10) throw new Error("batch size capped at 10 per query");

  const aliases = refs.map((r, i) => {
    const [owner, name] = r.repo.split("/");
    return `pr${i}: repository(owner: "${owner}", name: "${name}") {
      pullRequest(number: ${r.prNumber}) {
        number title author { login } mergedAt state baseRefName headRefName
        mergeCommit { oid }
        commits(first: 100) { totalCount nodes { commit {
          oid message authoredDate additions deletions
          author { user { login } email name }
          committer { email user { login } }
        } } }
        files(first: 100) { totalCount nodes { path additions deletions changeType } }
      }
    }`;
  }).join("\n");

  const query = `query Batch { ${aliases} }`;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${installationToken}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`graphql ${res.status}`);
  const body = (await res.json()) as { data: Record<string, PrHydrationResponse["repository"] | null> };
  return refs.map((_r, i) => body.data[`pr${i}`] ?? null);
}
