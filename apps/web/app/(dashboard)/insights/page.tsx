import { getWeeklyDigest } from "@bematist/api";
import { Badge, Card, CardHeader, CardTitle, ConfidenceBadge } from "@bematist/ui";
import type { Metadata } from "next";
import { getSessionCtx } from "@/lib/session";

export const metadata: Metadata = {
  title: "Insights",
};

const SUBJECT_LABEL: Record<
  "efficiency" | "outcome" | "adoption" | "team_impact" | "waste",
  string
> = {
  efficiency: "Efficiency",
  outcome: "Outcome quality",
  adoption: "Adoption depth",
  team_impact: "Team impact",
  waste: "Waste",
};

export default async function InsightsPage() {
  const ctx = await getSessionCtx();
  const digest = await getWeeklyDigest(ctx, {});

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-muted-foreground">
          Weekly digest from the Insight Engine. Low-confidence entries are dropped server-side.
          Citations link back to the session or cluster that grounded the claim.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <Badge tone="neutral">{digest.week_label}</Badge>
        <Badge tone="accent">
          {digest.insights.length} insight{digest.insights.length === 1 ? "" : "s"}
        </Badge>
        {digest.dropped_low_confidence > 0 ? (
          <Badge tone="warning">{digest.dropped_low_confidence} low-confidence · not shown</Badge>
        ) : null}
        <span className="text-muted-foreground/80">
          Generated {new Date(digest.generated_at).toLocaleString()}
        </span>
      </div>

      {digest.insights.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            No high- or medium-confidence insights for this week. The pipeline ran, but every
            candidate fell below the confidence threshold — the server does not surface those.
          </p>
        </Card>
      ) : (
        <ol className="flex flex-col gap-4" aria-label="Weekly insights">
          {digest.insights.map((i) => (
            <li key={i.id}>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <CardTitle className="text-base">{i.title}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">{SUBJECT_LABEL[i.subject_kind]}</Badge>
                      <ConfidenceBadge confidence={i.confidence} />
                    </div>
                  </div>
                </CardHeader>
                <p className="text-sm leading-relaxed text-foreground">{i.body}</p>
                {i.citations.length > 0 ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Cited
                    </span>
                    {i.citations.map((c) => (
                      <Badge
                        key={`${i.id}-${c.kind}-${c.id}`}
                        tone={c.kind === "cluster" ? "accent" : "neutral"}
                      >
                        {c.kind === "cluster" ? "Cluster · " : "Session · "}
                        {c.label}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
