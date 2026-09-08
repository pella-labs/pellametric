// F3.27 — Dev's own PRs list. Filters PR rows by authorLogin matching the
// signed-in user's githubLogin. Shows merged + open + closed.

import { headers } from "next/headers";
import Link from "next/link";
import { and, eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { requireMembership } from "@/lib/auth-middleware";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

function fmtState(state: string): React.ReactElement {
  const s = state.toLowerCase();
  const color =
    s === "merged" ? "var(--positive)" : s === "open" ? "var(--accent)" : "var(--muted-foreground)";
  return <span style={{ color }}>{state}</span>;
}

export default async function Page({
  params,
}: {
  params: Promise<{ provider: string; slug: string }>;
}) {
  const { provider, slug } = await params;
  const memb = await requireMembership(slug, { provider });
  if (memb instanceof Response) {
    return <div className="p-8 mk-table-cell">Access denied.</div>;
  }
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) return <div className="p-8 mk-table-cell">Not signed in.</div>;

  const [u] = await db
    .select({ login: schema.user.githubLogin })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  const login = u?.login ?? null;

  const base = `/me/${provider}/${slug}`;
  const orgBase = `/org/${provider}/${slug}`;

  if (!login) {
    return (
      <div className="p-6 space-y-4">
        <header>
          <p className="mk-eyebrow">Me · PRs</p>
          <h1 className="mk-heading text-2xl">Your pull requests</h1>
        </header>
        <p className="mk-table-cell text-(--muted-foreground)">
          We can't show your PRs until your GitHub identity is linked. Sign in via GitHub OAuth.
        </p>
      </div>
    );
  }

  const rows = await db
    .select()
    .from(schema.pr)
    .where(and(eq(schema.pr.orgId, memb.org.id), eq(schema.pr.authorLogin, login)))
    .orderBy(desc(schema.pr.createdAt))
    .limit(PAGE_SIZE);

  return (
    <div className="p-6 space-y-6">
      <header>
        <p className="mk-eyebrow">Me · PRs · {login}</p>
        <h1 className="mk-heading text-2xl">Your pull requests</h1>
        <p className="mk-table-cell text-(--muted-foreground)">
          {rows.length} PR{rows.length === 1 ? "" : "s"} authored by @{login}
        </p>
      </header>

      <div className="mk-panel">
        {rows.length === 0 ? (
          <p className="mk-table-cell text-(--muted-foreground)">No PRs yet.</p>
        ) : (
          <table className="w-full mk-table-cell">
            <thead className="text-left border-b border-(--border) text-(--muted-foreground)">
              <tr>
                <th className="py-2 pr-2">#</th>
                <th className="py-2 px-2">Title</th>
                <th className="py-2 px-2">Repo</th>
                <th className="py-2 px-2">State</th>
                <th className="py-2 px-2 text-right">+/-</th>
                <th className="py-2 pl-2 text-right">Merged</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} className="border-b border-(--border) hover:bg-(--secondary)">
                  <td className="py-2 pr-2 text-(--foreground)">
                    <Link href={`${orgBase}/prs/${p.number}`} className="hover:underline">
                      #{p.number}
                    </Link>
                  </td>
                  <td className="py-2 px-2 text-(--foreground) truncate max-w-[420px]">{p.title ?? "(untitled)"}</td>
                  <td className="py-2 px-2 text-(--muted-foreground) truncate max-w-[200px]">{p.repo}</td>
                  <td className="py-2 px-2">{fmtState(p.state)}</td>
                  <td className="py-2 px-2 text-right text-(--muted-foreground)">
                    <span className="text-(--positive)">+{p.additions}</span>{" "}
                    <span className="text-(--destructive)">-{p.deletions}</span>
                  </td>
                  <td className="py-2 pl-2 text-right text-(--muted-foreground)">
                    {p.mergedAt ? p.mergedAt.toISOString().slice(0, 10) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
