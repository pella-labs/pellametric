"use client";
import type { CreateIngestKeyOutput } from "@bematist/api/schemas/ingestKey";
import { Button, Card, CardHeader, CardTitle, Input } from "@bematist/ui";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/zodActions";
import { createIngestKeyAction } from "../actions";

interface Developer {
  id: string;
  email: string;
}

export interface MintKeyFormProps {
  developers: Developer[];
}

/**
 * Admin mint form. Posts to `createIngestKeyAction` (Server Action); on
 * success, surfaces the full bearer ONCE in an inline reveal panel with
 * copy-to-clipboard. The bearer is never stored — refresh the page and it's
 * gone forever. The admin must share it with the teammate (out-of-band or
 * copy-paste) while the panel is open.
 *
 * `useTransition` gives us a pending state without React Query / SWR.
 */
export function MintKeyForm({ developers }: MintKeyFormProps) {
  const [engineerId, setEngineerId] = useState<string>(developers[0]?.id ?? "");
  const [name, setName] = useState("");
  const [tier, setTier] = useState<"A" | "B">("B");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult<CreateIngestKeyOutput> | null>(null);

  const isDisabled = developers.length === 0 || !engineerId || name.trim().length === 0;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isDisabled) return;
    setResult(null);
    startTransition(async () => {
      const res = await createIngestKeyAction({
        engineer_id: engineerId,
        name: name.trim(),
        tier_default: tier,
      });
      setResult(res);
      if (res.ok) {
        setName("");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mint a new key</CardTitle>
      </CardHeader>

      {developers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No developers in this org yet. Seed one via `bun run db:seed` or the invite flow (not
          shipped in this PR).
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 text-xs">
            <label htmlFor="mint-engineer" className="text-muted-foreground">
              Developer
            </label>
            <select
              id="mint-engineer"
              value={engineerId}
              onChange={(e) => setEngineerId(e.target.value)}
              className="h-9 cursor-pointer rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              required
            >
              {developers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.email}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 text-xs">
            <label htmlFor="mint-name" className="text-muted-foreground">
              Name
            </label>
            <Input
              id="mint-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. alice's laptop"
              maxLength={128}
              required
            />
          </div>

          <div className="flex flex-col gap-1 text-xs">
            <label htmlFor="mint-tier" className="text-muted-foreground">
              Tier
            </label>
            <select
              id="mint-tier"
              value={tier}
              onChange={(e) => setTier(e.target.value as "A" | "B")}
              className="h-9 cursor-pointer rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="B">Tier B — default (counters + redacted envelopes)</option>
              <option value="A">Tier A — counters only</option>
            </select>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" disabled={isDisabled || pending}>
              {pending ? "Minting…" : "Mint key"}
            </Button>
            {result && !result.ok ? (
              <span className="text-xs text-destructive">{result.error.message}</span>
            ) : null}
          </div>
        </form>
      )}

      {result?.ok ? <BearerReveal minted={result.data} /> : null}
    </Card>
  );
}

/**
 * The ONE-shot bearer reveal. Shown only immediately after mint; gone on
 * navigation. The `<Input readOnly>` lets the admin triple-click-select without
 * the copy button hiding the secret.
 */
function BearerReveal({ minted }: { minted: CreateIngestKeyOutput }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(minted.bearer);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the input so the admin can cmd-C manually.
      const el = document.getElementById(`bearer-${minted.id}`) as HTMLInputElement | null;
      el?.select();
    }
  }

  return (
    <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-4">
      <p className="text-sm font-medium text-foreground">
        Key <span className="font-mono text-xs">{minted.id}</span> minted.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Copy this bearer now — it will not be shown again. Only the sha256 is stored.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Input
          id={`bearer-${minted.id}`}
          readOnly
          value={minted.bearer}
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-xs"
        />
        <Button type="button" variant="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Have the teammate set it as <code className="font-mono">BEMATIST_TOKEN</code> (or run{" "}
        <code className="font-mono">bematist install</code> with it).
      </p>
    </div>
  );
}
