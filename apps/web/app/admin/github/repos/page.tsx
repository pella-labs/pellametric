import { listGithubRepos } from "@bematist/api";
import { Badge, Card, CardHeader, CardTitle } from "@bematist/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getSessionCtx } from "@/lib/session";
import { RepoTrackingDropdown } from "../_components/RepoTrackingDropdown";

export const metadata: Metadata = {
  title: "Admin · GitHub repos",
};

/**
 * PRD §13 Phase G1 step 2b — admin/github/repos table.
 *
 * Read-only in G1; tracking PATCHes ship in G2-admin-apis.
 */
export default async function AdminGithubReposPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; include_archived?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const q = sp.q?.trim() || undefined;
  const includeArchived = sp.include_archived === "true";

  const ctx = await getSessionCtx();
  const data = await listGithubRepos(ctx, {
    page,
    per_page: 50,
    q,
    include_archived: includeArchived,
  });

  const hasNext = page * 50 < data.total;
  const hasPrev = page > 1;
  const buildQuery = (overrides: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const next = {
      page: String(page),
      q,
      include_archived: includeArchived ? "true" : undefined,
      ...overrides,
    };
    for (const [k, v] of Object.entries(next)) {
      if (v !== undefined && v !== "") p.set(k, v);
    }
    return `/admin/github/repos?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">GitHub repos</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Repos synced from your connected GitHub organization. "Effective tracked" collapses the
          tenant-wide tracking mode ({data.tracking_mode}) with each repo's
          <code className="mx-1 font-mono text-xs">tracking_state</code> into a single boolean.
          Editing lands in G2.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            Repos <span className="text-muted-foreground">({data.total})</span>
          </CardTitle>
        </CardHeader>

        {data.repos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No repos yet. Enqueue an initial sync from the{" "}
            <Link href="/admin/github" className="cursor-pointer text-primary underline">
              connection page
            </Link>
            .
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 font-medium">Repo</th>
                  <th className="py-2 font-medium">Default branch</th>
                  <th className="py-2 font-medium">Tracking state</th>
                  <th className="py-2 font-medium">Effective tracked</th>
                  <th className="py-2 font-medium">First seen</th>
                  <th className="py-2 font-medium">Archived</th>
                </tr>
              </thead>
              <tbody>
                {data.repos.map((r) => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-2 font-mono text-xs">{r.full_name}</td>
                    <td className="py-2 font-mono text-xs">{r.default_branch ?? "—"}</td>
                    <td className="py-2">
                      {r.provider_repo_id ? (
                        <RepoTrackingDropdown
                          providerRepoId={r.provider_repo_id}
                          currentState={r.tracking_state}
                        />
                      ) : (
                        <Badge tone="neutral">{r.tracking_state}</Badge>
                      )}
                    </td>
                    <td className="py-2">
                      <Badge tone={r.effective_tracked ? "positive" : "negative"}>
                        {r.effective_tracked ? "yes" : "no"}
                      </Badge>
                    </td>
                    <td className="py-2 font-mono text-xs text-muted-foreground">
                      {new Date(r.first_seen_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 font-mono text-xs text-muted-foreground">
                      {r.archived_at ? new Date(r.archived_at).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {data.page} · {data.per_page} per page
          </span>
          <div className="flex gap-2">
            <Link
              aria-disabled={!hasPrev}
              href={hasPrev ? buildQuery({ page: String(page - 1) }) : "#"}
              className={
                hasPrev
                  ? "cursor-pointer rounded-md border border-border px-2 py-1 hover:bg-muted"
                  : "cursor-not-allowed rounded-md border border-border px-2 py-1 opacity-40"
              }
            >
              ← Prev
            </Link>
            <Link
              aria-disabled={!hasNext}
              href={hasNext ? buildQuery({ page: String(page + 1) }) : "#"}
              className={
                hasNext
                  ? "cursor-pointer rounded-md border border-border px-2 py-1 hover:bg-muted"
                  : "cursor-not-allowed rounded-md border border-border px-2 py-1 opacity-40"
              }
            >
              Next →
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
