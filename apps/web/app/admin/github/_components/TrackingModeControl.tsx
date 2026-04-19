"use client";
import { useState, useTransition } from "react";
import { patchTrackingModeAction } from "../actions";
import { TrackingPreviewModal } from "./TrackingPreviewModal";

/**
 * Tracking-mode switcher for `/admin/github`. Wires the PATCH action but
 * routes through a preview modal first (dry-run projection, per PRD §14
 * "tracking-preview"). Admin-only; the Server Action re-asserts role.
 */
export function TrackingModeControl({ currentMode }: { currentMode: "all" | "selected" }) {
  const [pendingMode, setPendingMode] = useState<"all" | "selected" | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function requestChange(mode: "all" | "selected") {
    if (mode === currentMode) return;
    setPendingMode(mode);
    setError(null);
    setSuccessMsg(null);
  }

  function confirm() {
    const mode = pendingMode;
    if (!mode) return;
    startTransition(async () => {
      const res = await patchTrackingModeAction({ mode });
      if (res.ok) {
        setSuccessMsg(`Tracking mode set to "${res.data.mode}". Recompute queued.`);
        setPendingMode(null);
      } else {
        setError(res.error.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">Tracking mode</span>
        <fieldset className="inline-flex rounded-md border border-border">
          <legend className="sr-only">Tracking mode</legend>
          <button
            type="button"
            data-testid="tracking-mode-all"
            onClick={() => requestChange("all")}
            className={modeBtnClass(currentMode === "all")}
            disabled={isPending}
          >
            All
          </button>
          <button
            type="button"
            data-testid="tracking-mode-selected"
            onClick={() => requestChange("selected")}
            className={modeBtnClass(currentMode === "selected")}
            disabled={isPending}
          >
            Selected
          </button>
        </fieldset>
      </div>

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {successMsg ? (
        <p className="text-xs text-emerald-400" role="status">
          {successMsg}
        </p>
      ) : null}

      <TrackingPreviewModal
        open={pendingMode !== null}
        proposedMode={pendingMode ?? currentMode}
        onCancel={() => setPendingMode(null)}
        onConfirm={confirm}
        confirmLabel={isPending ? "Applying…" : "Apply mode change"}
      />
    </div>
  );
}

function modeBtnClass(active: boolean): string {
  const base =
    "cursor-pointer px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60";
  if (active) return `${base} bg-primary text-primary-foreground`;
  return `${base} bg-background hover:bg-muted`;
}

export default TrackingModeControl;
