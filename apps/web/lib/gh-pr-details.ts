// Richer per-PR fetch for dev drill-in.
export type PrDetail = {
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed";
  merged: boolean;
  mergedAt: string | null;
  createdAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  reviewComments: number;
  url: string;
};

async function gh(path: string, token: string) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!r.ok) return null;
  return r.json();
}

export async function prDetailsForMember(org: string, login: string, token: string): Promise<PrDetail[]> {
  const q = encodeURIComponent(`is:pr org:${org} author:${login}`);
  const data = await gh(`/search/issues?q=${q}&per_page=100`, token);
  const items = (data?.items ?? []) as any[];
  const out = await Promise.all(items.slice(0, 50).map(async (it: any) => {
    const [owner, repo] = (it.repository_url as string).replace("https://api.github.com/repos/", "").split("/");
    const pr: any = await gh(`/repos/${owner}/${repo}/pulls/${it.number}`, token);
    if (!pr) return null;
    return {
      repo: `${owner}/${repo}`,
      number: pr.number,
      title: pr.title,
      state: pr.state,
      merged: !!pr.merged_at,
      mergedAt: pr.merged_at,
      createdAt: pr.created_at,
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      changedFiles: pr.changed_files ?? 0,
      commits: pr.commits ?? 0,
      reviewComments: pr.review_comments ?? 0,
      url: pr.html_url,
    } as PrDetail;
  }));
  return out.filter(Boolean) as PrDetail[];
}
