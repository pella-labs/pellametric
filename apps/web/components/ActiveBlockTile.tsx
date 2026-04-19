import { Badge, Card, CardTitle } from "@bematist/ui";
import type { ActiveBlockSnapshot } from "@/lib/blocks";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const INT = new Intl.NumberFormat("en-US");
const TOK = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function formatMinutesAsHm(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * ccusage-parity "current billing block" tile. Rendered on any page that wants
 * to surface the IC's active 5-hour window: burn rate, projected cost,
 * tokens in block, and a ⚠ budget-guard when usage reaches ≥80% of the
 * historical peak block. Shared so `/me/digest` and `/outcomes` don't drift.
 */
export function ActiveBlockTile({
  snapshot,
  peakTokens,
}: {
  snapshot: ActiveBlockSnapshot;
  peakTokens: number;
}) {
  const { block, burnRate, projectedCost, remainingMs } = snapshot;
  const totalTokens =
    block.inputTokens + block.outputTokens + block.cacheReadTokens + block.cacheCreateTokens;
  const bandTone =
    burnRate.band === "HIGH"
      ? "text-red-500"
      : burnRate.band === "MODERATE"
        ? "text-amber-500"
        : "text-emerald-500";
  const peakPct = peakTokens > 0 ? totalTokens / peakTokens : 0;
  const budgetWarn = peakPct >= 0.8;
  return (
    <Card className="border-primary/40 bg-primary/5">
      <div className="flex flex-wrap items-baseline gap-3">
        <CardTitle className="text-base">Current billing block</CardTitle>
        <Badge className={bandTone}>{burnRate.band}</Badge>
        {budgetWarn ? (
          <Badge className="text-red-500">⚠ {(peakPct * 100).toFixed(0)}% of peak</Badge>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatMinutesAsHm(remainingMs)} remaining · block ends{" "}
          {new Date(block.endMs).toLocaleTimeString()}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-6 md:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">Spent so far</div>
          <div className="text-2xl font-semibold tabular-nums">{USD.format(block.cost)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Burn rate</div>
          <div className="text-2xl font-semibold tabular-nums">
            {USD.format(burnRate.costPerHour)}
            <span className="text-sm text-muted-foreground">/hr</span>
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {INT.format(Math.round(burnRate.tokensPerMinute))} tok/min
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Projected to block end</div>
          <div className="text-2xl font-semibold tabular-nums">{USD.format(projectedCost)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Tokens in block</div>
          <div className="text-2xl font-semibold tabular-nums">{TOK.format(totalTokens)}</div>
          {peakTokens > 0 ? (
            <div className="text-xs text-muted-foreground tabular-nums">
              peak: {TOK.format(peakTokens)}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        models: <span className="font-mono">{block.models.join(", ") || "—"}</span>
      </div>
    </Card>
  );
}
