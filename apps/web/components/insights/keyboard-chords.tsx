// F5.37 — Keyboard chords (g o / g i / g p / g d / g w) and a `?` modal.
// Mounted once globally inside the manager layout. Listens for keydown,
// debounces between the leading `g` and the action key (1.2s window).
// Respects an input element being focused — does nothing while typing.

"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";

type ChordTarget = {
  key: string;
  label: string;
  to: (base: string) => string;
};

const CHORDS: ChordTarget[] = [
  { key: "o", label: "Overview", to: b => b },
  { key: "i", label: "Insights", to: b => `${b}/insights` },
  { key: "p", label: "Pull requests", to: b => `${b}/prs` },
  { key: "d", label: "Devs", to: b => `${b}/devs` },
  { key: "w", label: "Waste", to: b => `${b}/waste` },
  { key: "n", label: "Intent", to: b => `${b}/intent` },
  { key: "b", label: "Benchmark", to: b => `${b}/benchmark` },
];

export function KeyboardChords({
  base,
}: {
  base: string;
}): React.ReactElement {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const params = useParams();

  useEffect(() => {
    let prefix: "g" | null = null;
    let prefixTimer: ReturnType<typeof setTimeout> | null = null;

    function isTyping(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (t.isContentEditable) return true;
      return false;
    }

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;

      // `?` opens help.
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(v => !v);
        return;
      }
      // Esc closes help.
      if (e.key === "Escape") {
        setHelpOpen(false);
        return;
      }
      if (prefix === "g") {
        const chord = CHORDS.find(c => c.key === e.key.toLowerCase());
        if (chord) {
          e.preventDefault();
          router.push(chord.to(base));
        }
        prefix = null;
        if (prefixTimer) clearTimeout(prefixTimer);
        return;
      }
      if (e.key.toLowerCase() === "g") {
        prefix = "g";
        if (prefixTimer) clearTimeout(prefixTimer);
        prefixTimer = setTimeout(() => {
          prefix = null;
        }, 1200);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (prefixTimer) clearTimeout(prefixTimer);
    };
  }, [router, base]);

  // Avoid hydration mismatch — useParams ensures we're in the right tree.
  void params;

  if (!helpOpen) return <></>;
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={() => setHelpOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="mk-panel bg-(--card) w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="mk-heading text-lg mb-3">Keyboard shortcuts</h3>
        <p className="mk-table-cell text-(--muted-foreground) mb-3">
          Press <kbd className="px-1 border border-(--border) rounded">g</kbd> then a key:
        </p>
        <ul className="space-y-2 mk-table-cell">
          {CHORDS.map(c => (
            <li key={c.key} className="flex items-baseline gap-3">
              <kbd className="px-1.5 py-0.5 border border-(--border) rounded text-(--foreground)">
                g {c.key}
              </kbd>
              <span className="text-(--foreground)">{c.label}</span>
            </li>
          ))}
          <li className="flex items-baseline gap-3 pt-2 border-t border-(--border)">
            <kbd className="px-1.5 py-0.5 border border-(--border) rounded text-(--foreground)">?</kbd>
            <span className="text-(--foreground)">Toggle this help</span>
          </li>
          <li className="flex items-baseline gap-3">
            <kbd className="px-1.5 py-0.5 border border-(--border) rounded text-(--foreground)">Esc</kbd>
            <span className="text-(--foreground)">Close this dialog</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
