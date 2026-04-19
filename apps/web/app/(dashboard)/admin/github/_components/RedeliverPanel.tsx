"use client";
import { Button, Input } from "@bematist/ui";
import { useState, useTransition } from "react";
import { redeliverWebhooksAction } from "../actions";

const EVENT_OPTIONS = [
  "pull_request",
  "pull_request_review",
  "push",
  "workflow_run",
  "check_suite",
  "deployment",
  "installation",
  "installation_repositories",
];

/**
 * Webhook redelivery panel for `/admin/github`. Accepts a date-range + an
 * optional event-type multiselect. On submit, calls the Server Action which
 * walks GitHub's `/app/hook/deliveries` for the window + POSTs each
 * `/attempts` endpoint.
 *
 * Rate-limit-aware: the mutation enforces 1 req/s/installation floor + 429
 * backoff. UX-wise we surface the `elapsed_seconds` so admins see the real
 * pacing cost.
 */
export function RedeliverPanel() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<null | {
    deliveries_requested: number;
    queued_attempts: number;
    failed_attempts: number;
    elapsed_seconds: number;
  }>(null);

  function submit() {
    if (!from || !to) {
      setError("Pick both from and to timestamps.");
      return;
    }
    const fromIso = toIsoOrNull(from);
    const toIsoV = toIsoOrNull(to);
    if (!fromIso || !toIsoV) {
      setError("Timestamps must be ISO-8601.");
      return;
    }
    setError(null);
    setResult(null);
    startTransition(async () => {
      const payload: {
        from: string;
        to: string;
        event_types?: string[];
      } = { from: fromIso, to: toIsoV };
      if (types.length > 0) payload.event_types = types;
      const res = await redeliverWebhooksAction(payload);
      if (res.ok) setResult(res.data);
      else setError(res.error.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">From (UTC)</span>
          <Input
            data-testid="redeliver-from"
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">To (UTC)</span>
          <Input
            data-testid="redeliver-to"
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm text-muted-foreground">Event types (optional)</legend>
        <div className="flex flex-wrap gap-2">
          {EVENT_OPTIONS.map((ev) => {
            const active = types.includes(ev);
            return (
              <button
                key={ev}
                type="button"
                data-testid={`redeliver-event-${ev}`}
                onClick={() => {
                  setTypes((prev) =>
                    prev.includes(ev) ? prev.filter((t) => t !== ev) : [...prev, ev],
                  );
                }}
                className={
                  active
                    ? "cursor-pointer rounded-md border border-primary bg-primary/10 px-2 py-1 text-xs"
                    : "cursor-pointer rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
                }
              >
                {ev}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex justify-start">
        <Button
          type="button"
          onClick={submit}
          disabled={isPending || !from || !to}
          className="cursor-pointer disabled:cursor-not-allowed"
          data-testid="redeliver-submit"
        >
          {isPending ? "Queueing…" : "Request redelivery"}
        </Button>
      </div>

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <div className="rounded-md border border-border p-3 text-sm" role="status">
          <p className="font-medium">Redelivery complete</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
            <dt>Deliveries in window</dt>
            <dd>{result.deliveries_requested}</dd>
            <dt>Queued attempts</dt>
            <dd className="text-emerald-400">{result.queued_attempts}</dd>
            <dt>Failed attempts</dt>
            <dd className="text-destructive">{result.failed_attempts}</dd>
            <dt>Elapsed seconds</dt>
            <dd>{result.elapsed_seconds.toFixed(1)}</dd>
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function toIsoOrNull(raw: string): string | null {
  // `datetime-local` gives us "YYYY-MM-DDTHH:mm"; append seconds + Z and
  // let the Date parser round-trip.
  try {
    const d = new Date(`${raw}:00.000Z`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}
