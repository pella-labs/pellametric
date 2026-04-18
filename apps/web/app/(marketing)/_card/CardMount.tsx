"use client";

import { useEffect, useState } from "react";
import { CardPage } from "./CardPage";
import type { CardData } from "./card-utils";

/**
 * Client-only mount wrapper for CardPage. CardPage reads navigator.share,
 * devicePixelRatio, and other browser-only globals during render, which
 * hydrates differently than SSR output. We suppress the server render and
 * match the original Vite implementation's client-only behavior.
 */
export function CardMount({ demoData }: { demoData?: CardData } = {}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div
        aria-hidden
        style={{
          minHeight: 520,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(237,232,222,0.3)",
          fontFamily: "var(--font-mk-mono, monospace)",
          fontSize: 12,
          letterSpacing: "0.08em",
        }}
      >
        LOADING CARD…
      </div>
    );
  }
  return demoData ? <CardPage demoData={demoData} /> : <CardPage />;
}
