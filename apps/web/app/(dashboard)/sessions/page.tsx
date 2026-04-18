import { listSessions, schemas } from "@bematist/api";
import { Badge } from "@bematist/ui";
import type { Metadata } from "next";
import { getSessionCtx } from "@/lib/session";
import { SessionsTable } from "./_table";
import { WindowPicker } from "./_window-picker";

export const metadata: Metadata = {
  title: "Sessions",
};

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; source?: string }>;
}) {
  const params = await searchParams;
  const window = parseWindow(params.window);
  const source = parseSource(params.source);

  const ctx = await getSessionCtx();
  const result = await listSessions(ctx, {
    window,
    limit: 500,
    ...(source ? { source } : {}),
  });

  const totalCost = result.sessions.reduce((acc, s) => acc + s.cost_usd, 0);
  const estimatedRows = result.sessions.filter((s) => s.cost_estimated).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
        <p className="text-sm text-muted-foreground">
          Every agent session visible to your role. Prompt text is never shown in the list — open a
          session and use Reveal to unlock with audit.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <WindowPicker value={window} />
        <Badge tone="accent">{result.total} sessions</Badge>
        <Badge tone="neutral">{USD.format(totalCost)} total</Badge>
        {estimatedRows > 0 ? (
          <Badge tone="warning">{estimatedRows} estimated-cost rows</Badge>
        ) : null}
      </div>

      <SessionsTable rows={result.sessions} />
    </div>
  );
}

function parseWindow(v: string | undefined): schemas.Window {
  const parsed = schemas.Window.safeParse(v);
  return parsed.success ? parsed.data : "7d";
}

function parseSource(v: string | undefined): schemas.SessionListItem["source"] | undefined {
  if (!v) return undefined;
  const parsed = schemas.SessionListItem.shape.source.safeParse(v);
  return parsed.success ? parsed.data : undefined;
}
