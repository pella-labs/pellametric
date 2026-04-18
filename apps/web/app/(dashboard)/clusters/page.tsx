import { findSessionTwins, listClusters } from "@bematist/api";
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

interface ClustersPageProps {
  /** Twin Finder search params: ?session_id=…&prompt_index=…&top_k=… */
  searchParams?: Promise<{
    session_id?: string;
    prompt_index?: string;
    top_k?: string;
  }>;
}

export default async function ClustersPage({ searchParams }: ClustersPageProps) {
  const ctx = await getSessionCtx();
  const sp = (await searchParams) ?? {};
  const [data, twins] = await Promise.all([
    listClusters(ctx, { window: "30d" }),
    sp.session_id
      ? findSessionTwins(ctx, {
          session_id: sp.session_id,
          ...(sp.prompt_index ? { prompt_index: Number(sp.prompt_index) } : {}),
          ...(sp.top_k ? { top_k: Math.min(25, Number(sp.top_k) || 10) } : {}),
        })
      : Promise.resolve(null),
  ]);

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

      <section aria-label="Twin Finder" className="flex flex-col gap-3">
        <header>
          <h2 className="text-lg font-semibold tracking-tight">Twin Finder</h2>
          <p className="text-sm text-muted-foreground">
            Find sessions whose prompt embeddings cluster near a query session. The k≥3 contributor
            floor is enforced server-side: candidate clusters with fewer than 3 distinct engineers
            are never surfaced. Engineer ids are returned as opaque hashes.
          </p>
        </header>

        <Card>
          <form className="flex flex-wrap items-end gap-3" method="get">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Session id</span>
              <input
                type="text"
                name="session_id"
                defaultValue={sp.session_id ?? ""}
                placeholder="ses_query_42"
                className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Prompt index</span>
              <input
                type="number"
                name="prompt_index"
                min={0}
                defaultValue={sp.prompt_index ?? "0"}
                className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Top K</span>
              <input
                type="number"
                name="top_k"
                min={1}
                max={25}
                defaultValue={sp.top_k ?? "10"}
                className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
            </label>
            <button
              type="submit"
              className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
            >
              Find twins
            </button>
          </form>
        </Card>

        {twins ? (
          twins.ok ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {twins.matches.length} twin{twins.matches.length === 1 ? "" : "s"} for{" "}
                  <code className="font-mono text-sm">{twins.query_session_id}</code>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Query cluster: <code className="font-mono">{twins.query_cluster_id ?? "—"}</code>{" "}
                  · {twins.latency_ms}ms
                </p>
              </CardHeader>
              {twins.matches.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No twins above the k≥3 contributor floor for this query.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1.5">Session</th>
                      <th className="py-1.5">Cluster</th>
                      <th className="py-1.5">Engineer (hash)</th>
                      <th className="py-1.5 text-right">Cosine similarity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {twins.matches.map((m) => (
                      <tr key={m.session_id} className="border-t border-border">
                        <td className="py-1.5 font-mono">{m.session_id}</td>
                        <td className="py-1.5 font-mono">{m.cluster_id}</td>
                        <td className="py-1.5 font-mono">{m.engineer_id_hash}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {m.similarity.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          ) : (
            <Card>
              <p className="text-sm">
                {twins.reason === "no_embedding"
                  ? `No prompt embedding for session ${twins.query_session_id}. The session may not have a Clio-abstracted prompt yet, or it predates the embed pipeline.`
                  : twins.reason === "cohort_too_small"
                    ? "Candidate cluster falls below the k≥3 contributor floor. Suppressed for privacy."
                    : "No matches in the candidate pool."}
              </p>
            </Card>
          )
        ) : null}
      </section>
    </div>
  );
}
