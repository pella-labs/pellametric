"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bematist/ui";
import { useEffect, useState } from "react";

interface PreviewData {
  sessions_that_would_become_eligible: number;
  sessions_that_would_become_ineligible: number;
  sample_eligible_sessions: string[];
  sample_ineligible_sessions: string[];
}

export interface TrackingPreviewModalProps {
  open: boolean;
  proposedMode: "all" | "selected";
  includedRepos?: string[];
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
}

/**
 * Client-side dry-run modal.
 *
 * On open, calls `GET /api/admin/github/tracking-preview` with the proposed
 * `mode` + optional `included_repos`. Displays `{ would_become_eligible,
 * would_become_ineligible, sample_sessions }` so the admin can see the
 * projected blast radius before confirming.
 */
export function TrackingPreviewModal({
  open,
  proposedMode,
  includedRepos,
  onCancel,
  onConfirm,
  confirmLabel,
}: TrackingPreviewModalProps) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const qp = new URLSearchParams({
          mode: proposedMode,
          included_repos: (includedRepos ?? []).join(","),
        });
        const res = await fetch(`/api/admin/github/tracking-preview?${qp.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? `Preview failed: HTTP ${res.status}`);
        }
        const body = (await res.json()) as PreviewData;
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Preview failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, proposedMode, includedRepos]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent data-testid="tracking-preview-modal">
        <DialogHeader>
          <DialogTitle>Preview mode change</DialogTitle>
          <DialogDescription>
            You're about to switch tracking mode to <strong>{proposedMode}</strong>. Below is the
            dry-run projection. No changes are saved until you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          {loading ? (
            <p className="text-muted-foreground">Computing projection…</p>
          ) : error ? (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          ) : data ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border p-3">
                  <div className="text-xs text-muted-foreground">Become eligible</div>
                  <div className="text-lg font-semibold text-emerald-400">
                    +{data.sessions_that_would_become_eligible}
                  </div>
                </div>
                <div className="rounded-md border border-border p-3">
                  <div className="text-xs text-muted-foreground">Become ineligible</div>
                  <div className="text-lg font-semibold text-destructive">
                    −{data.sessions_that_would_become_ineligible}
                  </div>
                </div>
              </div>
              {data.sample_eligible_sessions.length > 0 ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Sample newly-eligible sessions</summary>
                  <ul className="mt-1 list-inside list-disc font-mono">
                    {data.sample_eligible_sessions.slice(0, 10).map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {data.sample_ineligible_sessions.length > 0 ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Sample newly-ineligible sessions</summary>
                  <ul className="mt-1 list-inside list-disc font-mono">
                    {data.sample_ineligible_sessions.slice(0, 10).map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} className="cursor-pointer">
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={onConfirm}
            disabled={loading || Boolean(error)}
            className="cursor-pointer disabled:cursor-not-allowed"
          >
            {confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
