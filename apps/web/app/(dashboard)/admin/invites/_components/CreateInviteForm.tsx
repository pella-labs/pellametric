"use client";
import type { CreateInviteOutput } from "@bematist/api/schemas/invite";
import { Button, Card, CardHeader, CardTitle, Input } from "@bematist/ui";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/zodActions";
import { createInviteAction } from "../actions";

/**
 * Admin invite-mint form. Posts to `createInviteAction` (Server Action); on
 * success, surfaces the full share URL exactly ONCE in an inline reveal
 * panel with copy-to-clipboard.
 *
 * The URL is not a secret per se — anyone holding it can accept the invite
 * — but we still treat it like the ingest-key bearer UX: one-time display,
 * gone on navigation, admin must share it out-of-band while the panel is
 * open. Re-navigating after a mint re-fetches the list (the full token is
 * never retransmitted, only a `token_prefix`).
 */
export function CreateInviteForm() {
  const [role, setRole] = useState<"admin" | "ic">("ic");
  const [expiresInDays, setExpiresInDays] = useState<number>(14);
  // Empty string → unlimited (null sent to the action). Users rarely want
  // a cap; default UX is one link for the whole team.
  const [maxUsesInput, setMaxUsesInput] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult<CreateInviteOutput> | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    const trimmed = maxUsesInput.trim();
    const max_uses = trimmed === "" ? null : Number.parseInt(trimmed, 10);
    startTransition(async () => {
      const res = await createInviteAction({
        role,
        expires_in_days: expiresInDays,
        max_uses: max_uses === null || Number.isNaN(max_uses) ? null : max_uses,
      });
      setResult(res);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate an invite link</CardTitle>
      </CardHeader>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 text-xs">
          <label htmlFor="invite-role" className="text-muted-foreground">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "ic")}
            className="h-10 cursor-pointer rounded-md border border-input bg-background px-3.5 py-2 pr-9 text-sm text-foreground"
          >
            <option value="ic">Engineer (default) — can view own data + team aggregates</option>
            <option value="admin">Admin — can mint keys, invite, read audit logs</option>
          </select>
        </div>

        <div className="flex flex-col gap-1 text-xs">
          <label htmlFor="invite-expires" className="text-muted-foreground">
            Expires in (days)
          </label>
          <Input
            id="invite-expires"
            type="number"
            min={1}
            max={90}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(Number(e.target.value))}
          />
        </div>

        <div className="flex flex-col gap-1 text-xs">
          <label htmlFor="invite-max-uses" className="text-muted-foreground">
            Max uses (blank = unlimited)
          </label>
          <Input
            id="invite-max-uses"
            type="number"
            min={1}
            max={10000}
            placeholder="unlimited"
            value={maxUsesInput}
            onChange={(e) => setMaxUsesInput(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button type="submit" disabled={pending}>
            {pending ? "Generating…" : "Generate invite link"}
          </Button>
          {result && !result.ok ? (
            <span className="text-xs text-destructive">{result.error.message}</span>
          ) : null}
        </div>
      </form>

      {result?.ok ? <InviteReveal invite={result.data} /> : null}
    </Card>
  );
}

/**
 * The one-shot invite URL reveal. Shown only immediately after creation;
 * gone on navigation. The `<Input readOnly>` lets the admin triple-click-
 * select without the copy button hiding the URL.
 */
function InviteReveal({ invite }: { invite: CreateInviteOutput }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.getElementById(`invite-url-${invite.id}`) as HTMLInputElement | null;
      el?.select();
    }
  }

  return (
    <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-4">
      <p className="text-sm font-medium text-foreground">
        Invite link created for role <span className="font-mono text-xs">{invite.role}</span>.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Share this URL with invitees.{" "}
        {invite.max_uses === null
          ? "Anyone with this link can join."
          : `Good for up to ${invite.max_uses} ${invite.max_uses === 1 ? "acceptance" : "acceptances"}.`}{" "}
        Expires on {new Date(invite.expires_at).toLocaleString()}. Revoke from the list below if
        it's sent to the wrong person.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Input
          id={`invite-url-${invite.id}`}
          readOnly
          value={invite.url}
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-xs"
        />
        <Button type="button" variant="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
