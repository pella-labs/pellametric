import { getGithubConnection } from "@bematist/api";
import { Badge, Button, Card, CardHeader, CardTitle } from "@bematist/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getSessionCtx } from "@/lib/session";
import { StartSyncButton } from "./_components/StartSyncButton";
import { SyncProgressBar } from "./_components/SyncProgressBar";

export const metadata: Metadata = {
  title: "Admin · GitHub",
};

/**
 * PRD §13 Phase G1 step 2b — admin/github connection surface.
 *
 * RSC-first. Shows the connection card (install CTA if none; status +
 * last-reconcile + sync-progress if present). "Start sync" is a Server
 * Action; the "Dry-run preview" tile is disabled with a tooltip because
 * the tracking-mode editing surface ships in G2-admin-apis.
 */
export default async function AdminGithubPage() {
  const ctx = await getSessionCtx();
  const connection = await getGithubConnection(ctx, {});

  // Env drives the install URL — if not set, we render a generic instruction.
  const installSlug = process.env.GITHUB_APP_SLUG;
  const installUrl = installSlug
    ? `https://github.com/apps/${installSlug}/installations/new`
    : "https://docs.github.com/en/apps/creating-github-apps";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">GitHub</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Connect Bematist to your GitHub organization so we can correlate coding-agent sessions
          with PRs, commits, and green tests. Webhooks flow to the ingest service; initial repo sync
          fills the repo catalog and establishes the tracking lattice.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
        </CardHeader>

        {connection.installation === null ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              No GitHub App installation is bound to this org yet. Click below to install the
              Bematist GitHub App, select which repos to share, and return here.
            </p>
            <div>
              <Link
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="cursor-pointer"
              >
                <Button type="button" variant="default" className="cursor-pointer">
                  Install GitHub App
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">Org</dt>
                <dd className="font-mono">{connection.installation.github_org_login}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <Badge
                    tone={
                      connection.installation.status === "active"
                        ? "positive"
                        : connection.installation.status === "suspended"
                          ? "warning"
                          : "negative"
                    }
                  >
                    {connection.installation.status}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">Installation ID</dt>
                <dd className="font-mono text-xs">{connection.installation.installation_id}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">Installed</dt>
                <dd className="font-mono text-xs">
                  {new Date(connection.installation.installed_at).toLocaleString()}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">Last reconciled</dt>
                <dd className="font-mono text-xs">
                  {connection.installation.last_reconciled_at
                    ? new Date(connection.installation.last_reconciled_at).toLocaleString()
                    : "—"}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="text-muted-foreground">Tracking mode</dt>
                <dd>
                  <Badge tone="neutral">{connection.tracking_mode}</Badge>
                </dd>
              </div>
            </dl>

            {connection.installation.sync ? (
              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Initial sync</p>
                  <Badge tone="neutral">{connection.installation.sync.status}</Badge>
                </div>
                <SyncProgressBar progress={connection.installation.sync} />
                {connection.installation.sync.last_error ? (
                  <p className="text-xs text-destructive" role="alert">
                    {connection.installation.sync.last_error}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No sync has been started yet. Click below to enqueue one — this walks
                <code className="mx-1 font-mono text-xs">/installation/repositories</code>
                page-by-page with a 1 req/s floor and 5k/hr rate-limit headroom.
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              <StartSyncButton disabled={connection.installation.sync?.status === "running"} />
              <Link href="/admin/github/repos" className="cursor-pointer">
                <Button type="button" variant="outline" className="cursor-pointer">
                  View repos
                </Button>
              </Link>
              {/* G2-admin-apis owns tracking-mode editing. Slot stays here
                  with a disabled button + tooltip so the UX shape is present
                  in G1 but the behavior is explicitly gated. */}
              <span
                title="Available in G2 — tracking-mode editing not yet wired"
                className="inline-flex"
              >
                <Button type="button" variant="outline" disabled className="cursor-not-allowed">
                  Dry-run preview
                </Button>
              </span>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
