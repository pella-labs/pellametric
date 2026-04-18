"use client";
import { Button } from "@bematist/ui";
import { useState, useTransition } from "react";
import { revokeIngestKeyAction } from "../actions";

export interface RevokeKeyButtonProps {
  id: string;
}

/**
 * Single-click soft-delete. No confirmation modal in this PR — the action
 * is reversible by minting a new key, and the existing design system's
 * Dialog primitive is a heavier dependency than a 3-line `confirm()` in
 * a browser. Use `confirm()` as a minimal guardrail; upgrade to
 * `<Dialog>` when we add bulk-revoke.
 */
export function RevokeKeyButton({ id }: RevokeKeyButtonProps) {
  const [pending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function onRevoke() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Revoke key ${id}? Teammates using it will be 401d within 60s.`)
    )
      return;
    setErrorMessage(null);
    startTransition(async () => {
      const res = await revokeIngestKeyAction({ id });
      if (!res.ok) {
        setErrorMessage(res.error.message);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="destructive" size="xs" disabled={pending} onClick={onRevoke}>
        {pending ? "Revoking…" : "Revoke"}
      </Button>
      {errorMessage ? <span className="text-xs text-destructive">{errorMessage}</span> : null}
    </div>
  );
}
