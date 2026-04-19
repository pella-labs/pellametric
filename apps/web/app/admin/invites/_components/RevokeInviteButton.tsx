"use client";
import { Button } from "@bematist/ui";
import { useState, useTransition } from "react";
import { revokeInviteAction } from "../actions";

export interface RevokeInviteButtonProps {
  id: string;
}

/**
 * Single-click soft-delete. A revoked invite is unacceptable within one
 * request cycle (the acceptance path re-reads `revoked_at`). `confirm()` is
 * the minimal guardrail; upgrade to the `<Dialog>` primitive when we add
 * bulk-revoke.
 */
export function RevokeInviteButton({ id }: RevokeInviteButtonProps) {
  const [pending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function onRevoke() {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Revoke this invite? The link will stop working immediately.")
    )
      return;
    setErrorMessage(null);
    startTransition(async () => {
      const res = await revokeInviteAction({ id });
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
