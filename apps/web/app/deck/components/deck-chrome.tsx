"use client";

import type { DeckNav } from "../use-deck-nav";

/**
 * Host-level chrome that lives OUTSIDE the slide stage so it never scales
 * with the 1920×1080 content. Progress dots + counter + help toggle.
 */
export function DeckChrome({ nav, labels }: { nav: DeckNav; labels: readonly string[] }) {
  return (
    <>
      <nav className="deck-nav" aria-label="Slide navigation">
        {labels.map((label, i) => (
          <button
            key={`${label}-${i}`}
            type="button"
            className={`dot ${i === nav.index ? "active" : ""}`}
            aria-label={`Go to slide ${i + 1} — ${label}`}
            aria-current={i === nav.index ? "true" : undefined}
            onClick={() => nav.go(i)}
          />
        ))}
      </nav>
      <div className="deck-counter" aria-live="polite">
        {String(nav.index + 1).padStart(2, "0")} / {String(nav.total).padStart(2, "0")}
      </div>
      <button
        type="button"
        className="deck-help"
        onClick={nav.toggleHelp}
        aria-label="Keyboard shortcuts"
      >
        ? Shortcuts
      </button>
      {nav.showHelp ? <ShortcutsOverlay onClose={nav.closeHelp} /> : null}
    </>
  );
}

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="deck-shortcuts"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="deck-shortcuts-panel">
        <h3>Keyboard shortcuts</h3>
        <div>
          <kbd>→</kbd> <kbd>↓</kbd> <kbd>Space</kbd> next slide
        </div>
        <div>
          <kbd>←</kbd> <kbd>↑</kbd> previous slide
        </div>
        <div>
          <kbd>1</kbd>–<kbd>9</kbd> jump to slide
        </div>
        <div>
          <kbd>Home</kbd> / <kbd>End</kbd> first / last
        </div>
        <div>
          <kbd>R</kbd> reset to slide 1
        </div>
        <div>
          <kbd>?</kbd> toggle this help
        </div>
        <button type="button" className="deck-shortcuts-close" onClick={onClose}>
          Close (Esc)
        </button>
      </div>
    </div>
  );
}
