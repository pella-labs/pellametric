"use client";

import { type ChangeEvent, type ReactNode, useState, useTransition } from "react";
import { Button } from "../components/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/Dialog";
import { Textarea } from "../components/Input";

/**
 * Generic ActionResult contract the Reveal Server Action returns.
 *
 * This component must not import from `@bematist/api` directly — it lives in
 * a component package and needs to stay platform-agnostic. The hosting page
 * wires a concrete Server Action in and this file speaks only to the shape.
 */
export interface ActionResultLike<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface RevealDialogProps {
  sessionId: string;
  /**
   * The Server Action: takes `{ session_id, reason }` and returns an
   * `ActionResult`. Host passes the bound action (typically wrapped with
   * `zodAction`) from `apps/web/lib/actions/session.ts`.
   */
  revealAction: (input: {
    session_id: string;
    reason: string;
  }) => Promise<ActionResultLike<{ reveal_token: string; expires_at: string }>>;
  /** Optional trigger — defaults to a "Reveal prompt" Button. */
  trigger?: ReactNode;
  /** Called with the reveal token after a successful reveal. */
  onSuccess?: (token: string) => void;
}

const MIN_REASON = 20;

export function RevealDialog({ sessionId, revealAction, trigger, onSuccess }: RevealDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const reasonOk = reason.trim().length >= MIN_REASON;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await revealAction({ session_id: sessionId, reason });
      if (result.ok && result.data) {
        onSuccess?.(result.data.reveal_token);
        setOpen(false);
        setReason("");
        return;
      }
      setError(result.error?.message ?? "Reveal failed. Try again.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="secondary">Reveal prompt</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reveal prompt text</DialogTitle>
          <DialogDescription>
            This action is logged and the engineer is notified. Explain why the reveal is needed —
            your note is stored in the audit log and visible to the engineer in their digest.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
            Reveal requires one of: IC opt-in at project scope · tenant-wide signed Tier-C config ·
            active legal hold. Without one, the server will refuse.
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              Reason (min {MIN_REASON} characters)
            </span>
            <Textarea
              value={reason}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
              placeholder="Investigating a cost spike for the infra task family; need to confirm the agent wasn't looping…"
              aria-invalid={reason.length > 0 && !reasonOk}
            />
            <span className="text-xs text-muted-foreground">
              {reason.trim().length} / {MIN_REASON}
            </span>
          </label>

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
            >
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={submit} disabled={!reasonOk || isPending}>
              {isPending ? "Revealing…" : "Reveal"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
