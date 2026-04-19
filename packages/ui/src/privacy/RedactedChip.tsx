"use client";

import type { ReactNode } from "react";
import { Tooltip } from "../components/Tooltip";
import { cn } from "../lib/cn";
import { findMarkers, type RedactionType } from "./redactionMarker";

const TYPE_LABELS: Record<RedactionType, string> = {
  secret: "Secret",
  email: "Email",
  phone: "Phone",
  name: "Name",
  ip: "IP address",
  credit_card: "Credit card",
  ssn: "SSN",
  url: "URL",
  address: "Address",
  other: "Redacted",
};

export interface RedactedChipProps {
  type: RedactionType;
  hash: string;
  className?: string;
}

/**
 * Inline chip rendered in place of a `<REDACTED:type:hash>` marker.
 *
 * The `hash` is not shown to humans — it's for dedup analytics only. Hovering
 * reveals the human-readable type label.
 */
export function RedactedChip({ type, hash, className }: RedactedChipProps) {
  const label = TYPE_LABELS[type];
  return (
    <Tooltip
      content={
        <span>
          {label} redacted <span className="text-muted-foreground">(server-side)</span>
        </span>
      }
    >
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-sm border border-dashed border-border bg-muted px-1.5 py-0 font-mono text-[0.7rem] leading-5 text-muted-foreground",
          className,
        )}
        data-redaction-type={type}
        data-redaction-hash={hash}
        role="img"
        aria-label={`${label} redacted`}
      >
        {label.toLowerCase()}
      </span>
    </Tooltip>
  );
}

/**
 * Split `text` on `<REDACTED:…>` markers and return a React node stream of
 * plain strings and `<RedactedChip>` elements. Preserves whitespace verbatim.
 */
export function renderWithRedactions(text: string): ReactNode[] {
  const markers = findMarkers(text);
  if (markers.length === 0) return [text];

  const out: ReactNode[] = [];
  let cursor = 0;
  markers.forEach((m) => {
    if (m.start > cursor) {
      out.push(text.slice(cursor, m.start));
    }
    out.push(<RedactedChip key={`redacted-${m.start}-${m.hash}`} type={m.type} hash={m.hash} />);
    cursor = m.end;
  });
  if (cursor < text.length) {
    out.push(text.slice(cursor));
  }
  return out;
}
