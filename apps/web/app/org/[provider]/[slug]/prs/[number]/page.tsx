// Manager PR detail (T4.15). Gated by PELLAMETRIC_INSIGHTS_REVAMP_UI.
import { notFound } from "next/navigation";
import { insightsRevampEnabled } from "@/lib/feature-flags";
import { requireMembership } from "@/lib/auth-middleware";
import { db } from "@/lib/db";
import { org } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getPrDetail } from "@/lib/insights/get-pr-detail";
import { SourceBar } from "@/components/data/source-bar";
import { ConfidencePip } from "@/components/data/confidence-pip";
import { SourceChip } from "@/components/data/source-chip";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ provider: string; slug: string; number: string }>;
}) {
  if (!insightsRevampEnabled()) notFound();
  const { provider, slug, number } = await params;
  const prNumber = Number.parseInt(number, 10);
  if (!Number.isFinite(prNumber)) notFound();

  const auth = await requireMembership(slug, { provider });
  if (auth instanceof Response) {
    return <div className="p-8 mk-table-cell">Access denied.</div>;
  }
  // Look up org's repo set isn't necessary — PR is keyed by (orgId, repo, number);
  // detail page must accept ?repo= or scan. For simplicity, find the PR whose
  // repo+number matches under this org. We assume one PR per number per org for now.
  const orgRow = auth.org;
  // Find any pr with this number in this org (defensive — should be 1).
  const prRows = await db.query.pr.findMany({
    where: (p, { and: a, eq: e }) => a(e(p.orgId, orgRow.id), e(p.number, prNumber)),
    limit: 2,
  });
  if (prRows.length === 0) notFound();
  const detail = await getPrDetail(orgRow.id, prRows[0].repo, prNumber);
  if (!detail) notFound();

  const overallConfPct = detail.cost
    ? Math.round(
        (detail.cost.highConfLinks * 100 + detail.cost.mediumConfLinks * 60) /
          Math.max(1, detail.cost.highConfLinks + detail.cost.mediumConfLinks),
      )
    : null;
  const lowConf = overallConfPct !== null && overallConfPct < 70;

  return (
    <div className="p-6 space-y-6">
      <div>
        <a
          href={`/org/${provider}/${slug}/prs`}
          className="mk-table-cell text-(--muted-foreground) hover:text-(--foreground)"
        >
          ← back to PRs
        </a>
        <h1 className="text-xl font-medium mt-2">
          #{detail.pr.number} {detail.pr.title ?? "—"}
        </h1>
        <p className="mk-table-cell text-(--muted-foreground)">
          {detail.pr.repo} · by {detail.pr.authorLogin ?? "—"} · {detail.pr.state}
        </p>
      </div>

      {detail.pr.kind === "revert" && (
        <div className="border border-(--warning) bg-(--warning)/10 px-4 py-3 mk-table-cell">
          This PR is a revert.
        </div>
      )}
      {detail.revertedBy && (
        <div className="border border-(--warning) bg-(--warning)/10 px-4 py-3 mk-table-cell">
          Reverted by #{detail.revertedBy.number}.
        </div>
      )}
      {lowConf && (
        <div className="border border-(--border) bg-(--secondary) px-4 py-3 mk-table-cell">
          Overall lineage confidence is below 70% — attribution may be incomplete.
        </div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Linked sessions" value={detail.cost?.linkedSessions ?? 0} />
        <Tile label="Distinct devs" value={detail.cost?.linkedUsers ?? 0} />
        <Tile label="Tokens out" value={fmtNum(detail.cost?.tokensOut ?? 0)} />
        <Tile label="LOC net" value={`+${detail.pr.additions} −${detail.pr.deletions}`} />
      </section>

      {detail.cost && (
        <section className="space-y-2">
          <h2 className="mk-table-cell text-(--muted-foreground) uppercase tracking-wide">
            Source attribution
          </h2>
          <SourceBar
            pctClaude={detail.cost.pctClaude}
            pctCodex={detail.cost.pctCodex}
            pctCursor={detail.cost.pctCursor}
            pctHuman={detail.cost.pctHuman}
            pctBot={detail.cost.pctBot}
            height={12}
          />
        </section>
      )}

      <section className="space-y-2">
        <h2 className="mk-table-cell text-(--muted-foreground) uppercase tracking-wide">
          Linked sessions ({detail.links.length})
        </h2>
        <div className="border border-(--border) bg-(--card) overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-(--border)">
              <tr>
                <th className="mk-table-cell px-3 py-2 text-left text-(--muted-foreground)">when</th>
                <th className="mk-table-cell px-3 py-2 text-left text-(--muted-foreground)">dev</th>
                <th className="mk-table-cell px-3 py-2 text-left text-(--muted-foreground)">src</th>
                <th className="mk-table-cell px-3 py-2 text-left text-(--muted-foreground)">intent</th>
                <th className="mk-table-cell px-3 py-2 text-left text-(--muted-foreground)">conf</th>
              </tr>
            </thead>
            <tbody>
              {detail.links.map(l => (
                <tr key={l.sessionEventId} className="border-b border-(--border)">
                  <td className="mk-table-cell px-3 py-2">{l.session.startedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className="mk-table-cell px-3 py-2">{l.session.userLogin ?? "—"}</td>
                  <td className="mk-table-cell px-3 py-2">
                    <SourceChip kind={(l.session.source as "claude" | "codex" | "cursor")} />
                  </td>
                  <td className="mk-table-cell px-3 py-2">{l.session.intentTop ?? "—"}</td>
                  <td className="mk-table-cell px-3 py-2">
                    <ConfidencePip
                      confidence={(l.confidence as "high" | "medium" | "low") ?? "low"}
                      reason={`score=${l.confidenceScore} cwd=${l.cwdMatch} branch=${l.branchMatch}`}
                    />
                  </td>
                </tr>
              ))}
              {detail.links.length === 0 && (
                <tr>
                  <td colSpan={5} className="mk-table-cell px-3 py-6 text-center text-(--muted-foreground)">
                    No sessions linked to this PR yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-(--border) bg-(--card) p-4">
      <div className="mk-table-cell text-(--muted-foreground) uppercase tracking-wide">{label}</div>
      <div className="mk-stat-numeric mt-2 text-(--foreground)">{value}</div>
    </div>
  );
}

function fmtNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
