import { getSession } from "@bematist/api";
import {
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardValue,
  CostEstimatedChip,
  FidelityChip,
  InsufficientData,
  RevealDialog,
  renderWithRedactions,
} from "@bematist/ui";
import type { Metadata } from "next";
import { revealSessionAction } from "@/lib/actions/session";
import { getRevealedCtx } from "@/lib/session";

export const metadata: Metadata = {
  title: "Session detail",
};

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getRevealedCtx();
  const session = await getSession(ctx, { session_id: id });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs text-muted-foreground">Session · {session.session_id}</p>
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{session.source}</h1>
          <FidelityChip fidelity={session.fidelity} />
          <Badge tone={session.tier === "C" ? "warning" : "neutral"}>Tier {session.tier}</Badge>
        </div>
        <time className="text-xs text-muted-foreground" dateTime={session.started_at}>
          Started {new Date(session.started_at).toLocaleString()}
          {session.ended_at
            ? ` · ended ${new Date(session.ended_at).toLocaleString()}`
            : " · in progress"}
        </time>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Cost</CardTitle>
          </CardHeader>
          <CardValue className="flex items-baseline gap-2 text-xl">
            {USD.format(session.cost_usd)}
            {session.cost_estimated ? <CostEstimatedChip /> : null}
          </CardValue>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Input tokens</CardTitle>
          </CardHeader>
          <CardValue className="text-xl">{session.input_tokens.toLocaleString()}</CardValue>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Output tokens</CardTitle>
          </CardHeader>
          <CardValue className="text-xl">{session.output_tokens.toLocaleString()}</CardValue>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Accepted edits</CardTitle>
          </CardHeader>
          <CardValue className="text-xl">{session.accepted_edits}</CardValue>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Prompt</CardTitle>
        </CardHeader>
        {session.prompt_text === null ? (
          <div className="flex flex-col items-start gap-3">
            <InsufficientData reason="consent_required">
              <span>Prompt hidden — consent required</span>
            </InsufficientData>
            <RevealDialog sessionId={session.session_id} revealAction={revealSessionAction} />
          </div>
        ) : (
          <div className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
            {renderWithRedactions(session.prompt_text)}
          </div>
        )}
      </Card>
    </div>
  );
}
