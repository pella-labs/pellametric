import { getMyViewHistory } from "@bematist/api";
import { Badge, Card, CardHeader, CardTitle } from "@bematist/ui";
import type { Metadata } from "next";
import { getSessionCtx } from "@/lib/session";

export const metadata: Metadata = {
  title: "My digest",
  description:
    "Who has opened your surfaces — personal transparency log, delivered daily by default.",
};

const SURFACE_LABEL: Record<string, string> = {
  me_page: "Opened your /me page",
  session_detail: "Opened a session you owned",
  reveal_prompt: "Revealed one of your prompts",
  cluster_detail: "Opened a cluster you contributed to",
  csv_export: "Exported a CSV including your sessions",
};

export default async function MyDigestPage() {
  const ctx = await getSessionCtx();
  const history = await getMyViewHistory(ctx, { window: "24h" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">My digest</h1>
        <p className="text-sm text-muted-foreground">
          Every time a manager, admin, or auditor opens a surface that names you, a row lands here.
          Default delivery is a daily digest; you can switch to immediate notifications or opt out —
          transparency is the default, never a paid feature.
        </p>
        <div className="text-xs text-muted-foreground">
          Window: <Badge tone="neutral">{history.window}</Badge> · Preference:{" "}
          <Badge tone={history.notification_pref === "opted_out" ? "warning" : "accent"}>
            {history.notification_pref.replace("_", " ")}
          </Badge>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Recent views</CardTitle>
        </CardHeader>
        {history.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing in the last 24 hours. You'll see an entry here the first time someone with
            access opens a surface that names you.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {history.events.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">
                    {e.actor_display_name}{" "}
                    <span className="font-normal text-muted-foreground">({e.actor_role})</span>
                  </span>
                  <time className="font-mono text-xs text-muted-foreground" dateTime={e.ts}>
                    {new Date(e.ts).toLocaleString()}
                  </time>
                </div>
                <div className="text-xs text-muted-foreground">
                  {SURFACE_LABEL[e.surface] ?? e.surface}
                  {e.reason ? <span> — "{e.reason}"</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
