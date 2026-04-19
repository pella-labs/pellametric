"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface DeckNav {
  index: number;
  total: number;
  go: (i: number) => void;
  next: () => void;
  prev: () => void;
  reset: () => void;
  showHelp: boolean;
  toggleHelp: () => void;
  closeHelp: () => void;
}

/**
 * Keyboard-driven deck navigation.
 *
 * Bindings:
 *   ArrowRight / ArrowDown / Space / PageDown  → next
 *   ArrowLeft  / ArrowUp   / PageUp            → prev
 *   Home                                        → first
 *   End                                         → last
 *   R / r                                       → reset (slide 1)
 *   1..9                                        → jump to slide
 *   ?                                           → toggle shortcuts overlay
 *   Esc                                         → close overlay
 *
 * URL sync: `?slide=5` and `#5` both resolve to slide 5 (1-indexed).
 * Reduced-motion is honored by the caller — this hook only moves the index.
 */
export function useDeckNav(total: number): DeckNav {
  // Resolve initial index from query param or hash once on mount.
  const resolveInitial = useCallback((): number => {
    if (typeof window === "undefined") return 0;
    const params = new URLSearchParams(window.location.search);
    const qs = params.get("slide");
    const hash = window.location.hash.replace("#", "");
    const raw = Number(qs ?? hash);
    if (!Number.isFinite(raw)) return 0;
    const clamped = Math.min(Math.max(Math.trunc(raw), 1), total);
    return clamped - 1;
  }, [total]);

  const [index, setIndex] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const hasMounted = useRef(false);

  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;
    setIndex(resolveInitial());
  }, [resolveInitial]);

  const go = useCallback(
    (i: number) => {
      setIndex((prev) => {
        const next = Math.min(Math.max(i, 0), total - 1);
        if (next !== prev && typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("slide", String(next + 1));
          window.history.replaceState(null, "", url.toString());
        }
        return next;
      });
    },
    [total],
  );

  const next = useCallback(() => setIndex((i) => Math.min(i + 1, total - 1)), [total]);
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);
  const reset = useCallback(() => setIndex(0), []);
  const toggleHelp = useCallback(() => setShowHelp((v) => !v), []);
  const closeHelp = useCallback(() => setShowHelp(false), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("slide", String(index + 1));
    window.history.replaceState(null, "", url.toString());
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't swallow keys when typing in an input.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
          e.preventDefault();
          next();
          return;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          e.preventDefault();
          prev();
          return;
        case "Home":
          e.preventDefault();
          go(0);
          return;
        case "End":
          e.preventDefault();
          go(total - 1);
          return;
        case "r":
        case "R":
          e.preventDefault();
          reset();
          return;
        case "?":
          e.preventDefault();
          setShowHelp((v) => !v);
          return;
        case "Escape":
          if (showHelp) {
            e.preventDefault();
            setShowHelp(false);
          }
          return;
        default:
          if (/^[1-9]$/.test(e.key)) {
            e.preventDefault();
            go(Number(e.key) - 1);
          }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, next, prev, reset, total, showHelp]);

  return { index, total, go, next, prev, reset, showHelp, toggleHelp, closeHelp };
}
