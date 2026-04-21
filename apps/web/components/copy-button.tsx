"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

export default function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    }
  }
  return (
    <button
      onClick={copy}
      aria-label={label}
      title={copied ? "copied" : label}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-card hover:bg-popover hover:border-primary/40 text-muted-foreground hover:text-foreground text-[11px] font-mono transition"
    >
      {copied ? <Check className="size-3.5 text-positive" /> : <Copy className="size-3.5" />}
      {copied ? "copied" : "copy"}
    </button>
  );
}
