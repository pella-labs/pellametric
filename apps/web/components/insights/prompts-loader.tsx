// F3.28 / H1 — Click-to-decrypt prompts UX.
// Calls /api/me/sessions/[id]/prompts which enforces 60/min rate limit + Cache-
// Control: no-store + owner-only checks. The page-load HTML no longer carries
// plaintext prompt content, preventing accidental caching or proxy capture.

"use client";

import React, { useState } from "react";

export type PromptItem = {
  tsPrompt: string;
  wordCount: number;
  text: string;
};

export function PromptsLoader({
  sessionId,
  encryptedCount,
}: {
  sessionId: string;
  encryptedCount: number;
}): React.ReactElement {
  const [state, setState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [items, setItems] = useState<PromptItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setState("loading");
    setErr(null);
    try {
      const r = await fetch(`/api/me/sessions/${sessionId}/prompts`, {
        cache: "no-store",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setErr(body.error ?? `HTTP ${r.status}`);
        setState("error");
        return;
      }
      const j = await r.json();
      setItems((j.prompts as PromptItem[]) ?? (j.items as PromptItem[]) ?? []);
      setState("loaded");
    } catch (e) {
      setErr(String(e));
      setState("error");
    }
  }

  if (state === "idle") {
    return (
      <div className="mk-panel space-y-3">
        <p className="mk-label">Prompts</p>
        <p className="mk-table-cell text-(--muted-foreground)">
          Prompts are encrypted at rest with a key only you can derive. Decryption happens
          on demand and the response is `Cache-Control: no-store`.
        </p>
        <button
          type="button"
          onClick={load}
          className="mk-table-cell border border-(--border) hover:border-(--border-hover) rounded-[var(--radius)] px-3 py-1.5 text-(--foreground)"
        >
          Decrypt {encryptedCount} prompt{encryptedCount === 1 ? "" : "s"}
        </button>
      </div>
    );
  }
  if (state === "loading") {
    return (
      <div className="mk-panel">
        <p className="mk-label">Decrypting…</p>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="mk-panel space-y-2">
        <p className="mk-label text-(--destructive)">Could not decrypt</p>
        <p className="mk-table-cell text-(--muted-foreground)">{err}</p>
        <button
          type="button"
          onClick={load}
          className="mk-table-cell border border-(--border) hover:border-(--border-hover) rounded-[var(--radius)] px-3 py-1.5"
        >
          Retry
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="mk-label">Prompts ({items.length})</p>
      {items.length === 0 && (
        <p className="mk-table-cell text-(--muted-foreground)">
          No prompts captured (or retention has elapsed).
        </p>
      )}
      {items.map((p, i) => (
        <div key={i} className="mk-panel">
          <p className="mk-table-cell text-(--muted-foreground)">
            {p.tsPrompt.slice(11, 19)} · {p.wordCount} words
          </p>
          <pre className="whitespace-pre-wrap mt-2 text-sm leading-relaxed">{p.text}</pre>
        </div>
      ))}
    </div>
  );
}
