"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@bematist/ui";
import { useEffect, useState, useTransition } from "react";
import { rotateWebhookSecretAction } from "../actions";

/**
 * Webhook-secret rotation panel for `/admin/github`. Opens a confirmation
 * modal (destructive action — the old secret keeps validating for 10 min
 * before the eviction cron nulls it). Shows a countdown of the rotation
 * window after success.
 */
export function RotateSecretPanel() {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [windowExpires, setWindowExpires] = useState<Date | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    if (!windowExpires) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [windowExpires]);

  function submit() {
    startTransition(async () => {
      setError(null);
      const res = await rotateWebhookSecretAction({ new_secret_ref: ref });
      if (res.ok) {
        setOpen(false);
        setWindowExpires(new Date(res.data.window_expires_at));
        setRef("");
      } else {
        setError(res.error.message);
      }
    });
  }

  const secondsLeft = windowExpires
    ? Math.max(0, Math.floor((windowExpires.getTime() - now) / 1000))
    : 0;
  const windowActive = windowExpires !== null && secondsLeft > 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          className="cursor-pointer"
          data-testid="open-rotate-modal"
        >
          Rotate webhook secret
        </Button>
        {windowActive ? (
          <p className="text-xs text-muted-foreground" role="status">
            Dual-accept window: <span className="font-mono">{formatMs(secondsLeft)}</span>{" "}
            remaining.
          </p>
        ) : null}
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
      >
        <DialogContent data-testid="rotate-secret-modal">
          <DialogHeader>
            <DialogTitle>Rotate webhook secret</DialogTitle>
            <DialogDescription>
              The current secret becomes the <em>previous</em> secret and continues to accept
              signatures for 10 minutes. New signatures verify against the new secret immediately.
              Update your secrets-store first, then enter the new ref below.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">New secret ref</span>
              <Input
                data-testid="rotate-secret-ref-input"
                type="text"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="e.g. sm/bematist-gh-webhook-secret:v2"
                autoFocus
              />
            </label>
            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={submit}
              disabled={isPending || ref.trim() === ""}
              className="cursor-pointer disabled:cursor-not-allowed"
              data-testid="rotate-secret-confirm"
            >
              {isPending ? "Rotating…" : "Rotate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatMs(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
