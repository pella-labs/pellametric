"use client";

import { renderWithRedactions } from "@bematist/ui";

/**
 * Thin client wrapper so the server component can render prompt text inline
 * without directly calling `renderWithRedactions` — that helper lives behind
 * a `"use client"` boundary (it composes Radix Tooltip via RedactedChip) so
 * calling it from an RSC errors with "client function invoked from server".
 *
 * Passing the raw text across the server/client boundary as a prop is safe
 * (string), and the redaction marker parsing + chip rendering happens on
 * the client side as intended.
 */
export function PromptBody({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
      {renderWithRedactions(text)}
    </div>
  );
}
