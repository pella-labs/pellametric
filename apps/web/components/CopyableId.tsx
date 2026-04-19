"use client";

import { useState } from "react";

// Copy-to-clipboard chip. Client component because navigator.clipboard is a
// browser API; keep it small so the server-rendered session header stays
// server-component overall.
export function CopyableId({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex items-center gap-1.5 rounded border border-border/50 bg-muted/20 px-2 py-0.5 font-mono text-xs text-muted-foreground hover:border-border hover:text-foreground cursor-pointer transition-colors"
      title={copied ? "Copied!" : `Copy ${label ?? "value"}`}
    >
      <span>{value}</span>
      <span className="opacity-60">{copied ? "✓" : "⧉"}</span>
    </button>
  );
}
