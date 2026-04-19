import type { SyncProgress } from "@bematist/api/schemas/github/connection";

/**
 * Reads a `SyncProgress` object and renders a horizontal progress bar.
 * Pure presentational — no client-side polling here. Parent RSC page is
 * revalidated after the mutation; UI polling lands in G2 via the
 * `/api/admin/github/connection` route handler.
 *
 * When `total_repos` is unknown (very first page not yet fetched), we render
 * an indeterminate striped bar + "—" label.
 */
export function SyncProgressBar({ progress }: { progress: SyncProgress }) {
  const pct =
    progress.total_repos && progress.total_repos > 0
      ? Math.min(100, Math.round((progress.fetched_repos / progress.total_repos) * 100))
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {progress.fetched_repos}
          {progress.total_repos ? ` / ${progress.total_repos}` : ""} repos
        </span>
        {pct !== null ? <span>{pct}%</span> : <span>—</span>}
      </div>
      <div
        className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Sync progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
      >
        {pct !== null ? (
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
            aria-hidden
          />
        ) : (
          <div className="h-full w-1/3 animate-pulse bg-primary/50" aria-hidden />
        )}
      </div>
      {progress.eta_seconds !== null && progress.eta_seconds > 0 ? (
        <p className="text-xs text-muted-foreground">ETA ~{formatEta(progress.eta_seconds)}</p>
      ) : null}
    </div>
  );
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.ceil(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hours}h ${rem}m`;
}
