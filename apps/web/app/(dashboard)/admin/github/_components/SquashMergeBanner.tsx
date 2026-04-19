"use client";
import { Button } from "@bematist/ui";
import { useState, useTransition } from "react";
import { dismissAdminBannerAction } from "../actions";

/**
 * PRD-github-integration §17 risk #1 — squash-merge `AI-Assisted:` trailer
 * loss warning. Rendered on `/admin/github` when at least one tracked repo
 * has `merge_commit_allowed=false AND squash_merge_allowed=true`.
 *
 * Dismissal is per-admin (not per-tenant). Once dismissed, the banner does
 * not re-surface for that admin until a new squash-only repo appears.
 */
export function SquashMergeBanner({
  affectedRepoCount,
  sampleProviderRepoIds,
  initialDismissed,
}: {
  affectedRepoCount: number;
  sampleProviderRepoIds: string[];
  initialDismissed: boolean;
}) {
  const [dismissed, setDismissed] = useState(initialDismissed);
  const [isPending, startTransition] = useTransition();

  if (dismissed) return null;
  if (affectedRepoCount === 0) return null;

  function handleDismiss() {
    startTransition(async () => {
      const res = await dismissAdminBannerAction({ banner_key: "squash_merge_trailer_loss" });
      if (res.ok) setDismissed(true);
    });
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex flex-col gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-900 dark:text-yellow-100"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-medium">
            {affectedRepoCount} of your tracked repos use squash-merge only.
          </p>
          <p className="text-muted-foreground">
            The <code className="font-mono text-xs">AI-Assisted:</code> commit trailer from{" "}
            <code className="font-mono text-xs">bematist policy set ai-assisted-trailer=on</code> is
            dropped on squash-merge. Attribution falls back to the commit_sha + CODEOWNERS join —
            still accurate but less auditable. See{" "}
            <a
              href="/docs/commit-trailer"
              className="cursor-pointer underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              docs/commit-trailer
            </a>{" "}
            for the full posture.
          </p>
          {sampleProviderRepoIds.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Sample repo IDs: <span className="font-mono">{sampleProviderRepoIds.join(", ")}</span>
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          disabled={isPending}
          className="cursor-pointer"
          aria-label="Dismiss banner"
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}
