"use client";

import { Button } from "@bematist/ui";
import { useState, useTransition } from "react";
import { approveDeviceAction, denyDeviceAction } from "./actions";

export interface DeviceApproveClientProps {
  userCode: string;
  deviceLabel: string | null;
  userEmail: string | null;
}

/**
 * Interactive shell on /auth/device: shows the user-code for confirmation
 * against what the terminal printed, then renders Approve + Deny buttons
 * bound to server actions. After a terminal state flips, the card swaps
 * out for a "you can close this tab" confirmation.
 *
 * No polling — the CLI picks up the approval via its own /api/auth/device/
 * poll call. This UI only confirms that the server-side flag flipped.
 */
export function DeviceApproveClient({
  userCode,
  deviceLabel,
  userEmail,
}: DeviceApproveClientProps) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<
    | null
    | { kind: "approved"; orgName: string }
    | { kind: "denied" }
    | { kind: "error"; message: string }
  >(null);

  function doApprove() {
    setOutcome(null);
    startTransition(async () => {
      const res = await approveDeviceAction(userCode);
      if (res.ok) {
        setOutcome({ kind: "approved", orgName: res.orgName });
      } else {
        setOutcome({ kind: "error", message: errorMessage(res.reason) });
      }
    });
  }

  function doDeny() {
    setOutcome(null);
    startTransition(async () => {
      const res = await denyDeviceAction(userCode);
      if (res.ok) {
        setOutcome({ kind: "denied" });
      } else {
        setOutcome({ kind: "error", message: errorMessage(res.reason) });
      }
    });
  }

  if (outcome?.kind === "approved") {
    return (
      <ResultCard
        tag="Approved"
        tagColor="text-primary"
        title={`Authorized in ${outcome.orgName}`}
        body="Your terminal should finish within a few seconds. You can close this tab."
      />
    );
  }
  if (outcome?.kind === "denied") {
    return (
      <ResultCard
        tag="Denied"
        tagColor="text-destructive"
        title="Request denied"
        body="The CLI will stop polling shortly. If you meant to approve, run `bematist login` again."
      />
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-6 rounded-xl border border-border bg-card p-8 shadow-sm">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Authorize CLI session
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">
          Confirm this code matches your terminal
        </h1>
        {userEmail ? (
          <p className="text-sm text-muted-foreground">
            Signed in as <strong className="text-foreground">{userEmail}</strong>.
          </p>
        ) : null}
      </div>

      {/* Big, monospaced code — user visually compares with their terminal. */}
      <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-muted/40 p-6">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">User code</span>
        <span className="font-mono text-3xl font-semibold tracking-[0.2em] text-foreground">
          {formatCode(userCode)}
        </span>
      </div>

      {deviceLabel ? (
        <p className="text-xs text-muted-foreground">
          Device: <code className="font-mono text-foreground">{deviceLabel}</code>
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="lg"
          variant="default"
          onClick={doApprove}
          disabled={pending}
          aria-busy={pending}
          className="w-full cursor-pointer"
        >
          {pending ? "Authorizing…" : "Approve"}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={doDeny}
          disabled={pending}
          aria-busy={pending}
          className="w-full cursor-pointer"
        >
          Deny
        </Button>
      </div>

      {outcome?.kind === "error" ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {outcome.message}
        </p>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        Approving mints a new ingest key tagged with this device and tied to your org. The CLI
        receives its bearer and starts streaming events to your dashboard. You can revoke the key at
        any time from{" "}
        <a
          href="/admin/ingest-keys"
          className="cursor-pointer underline underline-offset-2 hover:text-foreground"
        >
          /admin/ingest-keys
        </a>
        .
      </p>
    </div>
  );
}

function formatCode(code: string): string {
  // "ABCD1234" → "ABCD-1234" for visual scanning. Pure display — not the
  // shape we match against server-side.
  if (code.length === 8) return `${code.slice(0, 4)}-${code.slice(4)}`;
  return code;
}

function ResultCard({
  tag,
  tagColor,
  title,
  body,
}: {
  tag: string;
  tagColor: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-card p-8 shadow-sm">
      <span className={`text-xs font-medium uppercase tracking-wide ${tagColor}`}>{tag}</span>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function errorMessage(reason: string): string {
  switch (reason) {
    case "not_signed_in":
      return "Your session expired. Refresh the page to sign in again.";
    case "not_found":
      return "This code doesn't exist. Run `bematist login` again.";
    case "expired":
      return "This code expired. Run `bematist login` again.";
    case "already_finalized":
      return "This code was already approved or denied.";
    case "no_org":
      return "You don't appear to belong to an org yet — complete onboarding first.";
    default:
      return "Something went wrong. Try again.";
  }
}
