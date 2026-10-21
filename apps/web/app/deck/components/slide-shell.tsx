import type { ReactNode } from "react";

/**
 * Slide chrome — header row (wordmark + section label) and footer
 * (telemetryc.com only). Matches the standalone deck's visual language.
 * Rendered inside the 1920×1080 stage. The per-slide page-number indicator
 * was removed — the deck-level counter from `DeckChrome` is the single
 * source of truth for position, so the props stay accepted (call sites
 * still pass them) but are no longer rendered here.
 */
export function SlideShell({
  children,
  sectionLabel,
  withChrome = true,
  leftFoot = "telemetryc.com",
  gridBg = true,
  className,
}: {
  children: ReactNode;
  sectionLabel?: string;
  pageNumber?: number;
  totalPages?: number;
  withChrome?: boolean;
  leftFoot?: string;
  gridBg?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`slide${withChrome ? " with-chrome" : ""}${className ? ` ${className}` : ""}`}
    >
      {gridBg ? <div className="grid-bg" /> : null}
      {withChrome && sectionLabel ? (
        <div className="chrome-row">
          <div className="wordmark">
            <img
              className="wordmark-dot"
              src="/primary-logo.svg"
              alt="Telemetryc"
            />
          </div>
          <div className="chrome-right">{sectionLabel}</div>
        </div>
      ) : null}
      <div className="slide-body">{children}</div>
      <div className="pagenum-left">{leftFoot}</div>
    </div>
  );
}
