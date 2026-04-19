"use client";
import { useState, useTransition } from "react";
import { patchRepoTrackingAction } from "../actions";

/**
 * Per-repo tracking-state dropdown (inherit | included | excluded). Used
 * inline in the repos table. Admin-only; the Server Action re-asserts role.
 *
 * Shows inline "Saving…" state + error text next to the dropdown on failure.
 */
export function RepoTrackingDropdown({
  providerRepoId,
  currentState,
}: {
  providerRepoId: string;
  currentState: "inherit" | "included" | "excluded";
}) {
  const [state, setState] = useState(currentState);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <select
        data-testid={`repo-tracking-select-${providerRepoId}`}
        value={state}
        disabled={isPending}
        onChange={(e) => {
          const next = e.target.value as "inherit" | "included" | "excluded";
          const prev = state;
          setState(next);
          setError(null);
          startTransition(async () => {
            const res = await patchRepoTrackingAction({
              provider_repo_id: providerRepoId,
              state: next,
            });
            if (!res.ok) {
              setState(prev); // rollback
              setError(res.error.message);
            }
          });
        }}
        className="cursor-pointer rounded-md border border-border bg-background px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="inherit">inherit</option>
        <option value="included">included</option>
        <option value="excluded">excluded</option>
      </select>
      {isPending ? <span className="text-xs text-muted-foreground">Saving…</span> : null}
      {error ? (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
