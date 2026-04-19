import { Card, CardHeader, CardTitle } from "@bematist/ui";
import type { Metadata } from "next";
import { SourceBadge } from "@/components/SourceBadge";
import { getLocalData } from "@/lib/local-sources";

export const metadata: Metadata = {
  title: "Clusters",
};

export const dynamic = "force-dynamic";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const INT = new Intl.NumberFormat("en-US");
const TOK = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export default async function ClustersPage() {
  const { analytics } = await getLocalData();
  const projects = [...analytics.projectBreakdowns].sort((a, b) => b.cost - a.cost);
  const categories = [...analytics.categoryBreakdowns].sort((a, b) => b.cost - a.cost);
  const branches = [...analytics.branchCosts].sort((a, b) => b.cost - a.cost).slice(0, 20);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Clusters</h1>
        <p className="text-sm text-muted-foreground">
          Sessions grouped by activity category, project, and git branch. A proxy for prompt
          clusters until the Clio embedding pipeline lands — but sourced from real local session
          data, not fixtures.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-5">
        {categories.map((c) => (
          <Card key={c.category}>
            <CardHeader>
              <CardTitle>{c.category}</CardTitle>
            </CardHeader>
            <div className="text-2xl font-semibold tabular-nums">{USD.format(c.cost)}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {INT.format(c.sessions)} sessions
            </div>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
        </CardHeader>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2">Project</th>
              <th className="pb-2">Sources</th>
              <th className="pb-2 text-right">Sessions</th>
              <th className="pb-2 text-right">Tokens</th>
              <th className="pb-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.project} className="border-t border-border/40">
                <td className="py-2">{p.displayName}</td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {p.sources.map((src) => (
                      <SourceBadge key={src} source={src} size="xs" />
                    ))}
                  </div>
                </td>
                <td className="py-2 text-right tabular-nums">{INT.format(p.sessions)}</td>
                <td className="py-2 text-right tabular-nums">{TOK.format(p.tokens)}</td>
                <td className="py-2 text-right tabular-nums">{USD.format(p.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Most expensive branches</CardTitle>
        </CardHeader>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2">Branch</th>
              <th className="pb-2">Project</th>
              <th className="pb-2 text-right">Sessions</th>
              <th className="pb-2 text-right">Tokens</th>
              <th className="pb-2 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={`${b.project}:${b.branch}`} className="border-t border-border/40">
                <td className="py-2 font-mono text-xs">{b.branch || "(none)"}</td>
                <td className="py-2 text-xs text-muted-foreground">{b.project}</td>
                <td className="py-2 text-right tabular-nums">{INT.format(b.sessions)}</td>
                <td className="py-2 text-right tabular-nums">{TOK.format(b.tokens)}</td>
                <td className="py-2 text-right tabular-nums">{USD.format(b.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
