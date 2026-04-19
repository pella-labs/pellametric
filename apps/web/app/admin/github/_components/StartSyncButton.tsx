"use client";
import { Button } from "@bematist/ui";
import { useState, useTransition } from "react";
import { enqueueSyncAction } from "../actions";

/**
 * Client component — wraps the `enqueueSyncAction` Server Action.
 *
 * Shows inline feedback; relies on RSC revalidation to reload the parent
 * page's connection widget. Disabled while `pending` so double-clicks are
 * inert (defense-in-depth — the mutation itself is idempotent via the
 * `(tenant_id, installation_id)` UPSERT).
 */
export function StartSyncButton({ disabled }: { disabled?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        disabled={disabled || isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await enqueueSyncAction({});
            if (!result.ok) {
              setError(result.error.message);
            }
          });
        }}
        className="cursor-pointer disabled:cursor-not-allowed"
      >
        {isPending ? "Enqueueing…" : "Start sync"}
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
