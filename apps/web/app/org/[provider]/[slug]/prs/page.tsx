// Manager PR list (T4.14). Gated by PELLAMETRIC_INSIGHTS_REVAMP_UI.
import { notFound } from "next/navigation";
import Link from "next/link";
import { insightsRevampEnabled } from "@/lib/feature-flags";
import { requireMembership } from "@/lib/auth-middleware";
import { getPrsForOrg } from "@/lib/insights/get-prs-for-org";
import { SourceBar } from "@/components/data/source-bar";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ provider: string; slug: string }>;
}) {
  if (!insightsRevampEnabled()) notFound();
  const { provider, slug } = await params;
  const auth = await requireMembership(slug, { provider });
  if (auth instanceof Response) {
    return (
      <div className="p-8 mk-table-cell">
        Access denied.
      </div>
    );
  }
  const prs = await getPrsForOrg(auth.org.id, { window: "30d" });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-medium">Pull requests · {slug}</h1>
      <p className="mk-table-cell text-(--muted-foreground)">
        {prs.length} PRs in the last 30 days
        {auth.org.githubAppInstallationId == null && " (install GitHub App to see token attribution + cost per PR)"}
      </p>
      <div className="border border-(--border) bg-(--card) overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-(--border)">
            <tr>
              <th className="mk-table-cell px-3 py-2 text-left text-(--muted-foreground)">#</th>
              <th className="mk-table-cell px-3 py-2 text-left text-(--muted-foreground)">title</th>
              <th className="mk-table-cell px-3 py-2 text-left text-(--muted-foreground)">author</th>
              <th className="mk-table-cell px-3 py-2 text-left text-(--muted-foreground)">src mix</th>
              <th className="mk-table-cell px-3 py-2 text-right text-(--muted-foreground)">+/-</th>
            </tr>
          </thead>
          <tbody>
            {prs.map(p => (
              <tr key={`${p.repo}#${p.number}`} className="border-b border-(--border) hover:bg-(--secondary)">
                <td className="mk-table-cell px-3 py-2">
                  <Link href={`/org/${provider}/${slug}/prs/${p.number}`} className="text-(--primary) hover:underline">
                    #{p.number}
                  </Link>
                </td>
                <td className="mk-table-cell px-3 py-2 max-w-md truncate">{p.title ?? "—"}</td>
                <td className="mk-table-cell px-3 py-2">{p.authorLogin ?? "—"}</td>
                <td className="mk-table-cell px-3 py-2 min-w-32">
                  {p.prId ? <SourceBar pctClaude={0} pctCodex={0} pctCursor={0} pctHuman={100} showLabel={false} /> : "—"}
                </td>
                <td className="mk-table-cell px-3 py-2 text-right">
                  <span className="text-(--positive)">+{p.additions}</span>{" "}
                  <span className="text-(--destructive)">-{p.deletions}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
