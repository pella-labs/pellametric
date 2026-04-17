import { listClusters } from "@bematist/api";
import { Badge, Card, CardHeader, CardTitle, FidelityChip } from "@bematist/ui";
import type { Metadata } from "next";
import { getSessionCtx } from "@/lib/session";

export const metadata: Metadata = {
  title: "Clusters",
};

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

export default async function ClustersPage() {
  const ctx = await getSessionCtx();
  const data = await listClusters(ctx, { window: "30d" });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Clusters</h1>
        <p className="text-sm text-muted-foreground">
          Prompt-pattern clusters from the on-device Clio pipeline. Labels are 3–5 words,
          regex-validated — no URLs, no proper nouns, no PII. The k≥3 contributor floor is enforced
          server-side: clusters below the floor are computed but never surfaced.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <Badge tone="neutral">30-day window</Badge>
        <Badge tone="accent">{data.clusters.length} clusters</Badge>
        {data.suppressed_below_floor > 0 ? (
          <Badge tone="warning">{data.suppressed_below_floor} suppressed · below k=3 floor</Badge>
        ) : null}
      </div>

      <section aria-label="Cluster list" className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {data.clusters.map((c) => {
          const merged = c.top_outcomes.find((o) => o.kind === "merged_pr")?.count ?? 0;
          const green = c.top_outcomes.find((o) => o.kind === "green_test")?.count ?? 0;
          const reverts = c.top_outcomes.find((o) => o.kind === "revert")?.count ?? 0;
          return (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base">{c.label}</CardTitle>
                  <FidelityChip fidelity={c.fidelity} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {c.contributor_count} contributors · {c.session_count} sessions
                </p>
              </CardHeader>
              <dl className="grid grid-cols-4 gap-3 text-xs">
                <div>
                  <dt className="text-muted-foreground">Avg cost</dt>
                  <dd className="mt-0.5 font-medium text-sm">{USD.format(c.avg_cost_usd)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Merged PRs</dt>
                  <dd className="mt-0.5 font-medium text-sm">{merged}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Green tests</dt>
                  <dd className="mt-0.5 font-medium text-sm">{green}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Reverts</dt>
                  <dd
                    className={
                      reverts > 0
                        ? "mt-0.5 font-medium text-sm text-warning"
                        : "mt-0.5 font-medium text-sm"
                    }
                  >
                    {reverts}
                  </dd>
                </div>
              </dl>
            </Card>
          );
        })}
      </section>

      {data.clusters.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            No clusters pass the k≥3 floor for this window. This is the privacy-preserving default —
            clusters emerge as more engineers contribute prompts in the same pattern.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
