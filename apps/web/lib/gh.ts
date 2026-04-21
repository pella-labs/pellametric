// GitHub helpers for manager view — fetch PR + LOC per org member.

export type PrAgg = {
  login: string;
  opened: number;
  merged: number;
  closed: number;        // closed-without-merge
  openNow: number;
  additions: number;
  deletions: number;
};

async function gh<T = any>(path: string, token: string): Promise<T | null> {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    cache: "no-store",
  });
  if (!r.ok) return null;
  return r.json();
}

export async function prAggForMember(org: string, login: string, token: string): Promise<PrAgg> {
  // Search returns up to 1000, which is plenty for a 30-day window per member.
  const q = encodeURIComponent(`is:pr org:${org} author:${login}`);
  const data = await gh<any>(`/search/issues?q=${q}&per_page=100`, token);
  const items = (data?.items ?? []) as any[];

  const agg: PrAgg = { login, opened: items.length, merged: 0, closed: 0, openNow: 0, additions: 0, deletions: 0 };

  // We need state + additions/deletions. Search doesn't include them — fetch each PR.
  // To keep cost bounded: only fetch additions/deletions for the first 50 PRs.
  const detailFetches = items.slice(0, 50).map(async (it) => {
    if (it.state === "open") agg.openNow++;
    // pull_request.merged_at tells merged vs closed-without-merge
    const merged = !!it.pull_request?.merged_at;
    if (merged) agg.merged++;
    else if (it.state === "closed") agg.closed++;
    // fetch LOC
    try {
      const [owner, repo] = (it.repository_url as string).replace("https://api.github.com/repos/", "").split("/");
      const pr = await gh<any>(`/repos/${owner}/${repo}/pulls/${it.number}`, token);
      if (pr) {
        agg.additions += pr.additions ?? 0;
        agg.deletions += pr.deletions ?? 0;
      }
    } catch { /* ignore */ }
  });
  await Promise.all(detailFetches);

  // Account for any PRs beyond the first 50 (state only, no LOC)
  for (const it of items.slice(50)) {
    if (it.state === "open") agg.openNow++;
    const merged = !!it.pull_request?.merged_at;
    if (merged) agg.merged++;
    else if (it.state === "closed") agg.closed++;
  }

  return agg;
}
