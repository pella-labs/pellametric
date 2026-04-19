import type { ReactNode } from "react";

/**
 * Slide chrome — header row (wordmark + section label) and footer
 * (bematist.dev + page number). Matches the standalone deck's visual
 * language exactly. Rendered inside the 1920×1080 stage.
 */
export function SlideShell({
  children,
  sectionLabel,
  pageNumber,
  totalPages,
  withChrome = true,
  leftFoot = "bematist.dev",
  gridBg = true,
  className,
}: {
  children: ReactNode;
  sectionLabel?: string;
  pageNumber: number;
  totalPages: number;
  withChrome?: boolean;
  leftFoot?: string;
  gridBg?: boolean;
  className?: string;
}) {
  const pad = String(pageNumber).padStart(2, "0");
  const padTotal = String(totalPages).padStart(2, "0");
  return (
    <div className={`slide${withChrome ? " with-chrome" : ""}${className ? ` ${className}` : ""}`}>
      {gridBg ? <div className="grid-bg" /> : null}
      {withChrome && sectionLabel ? (
        <div className="chrome-row">
          <div className="wordmark">
            <span className="wordmark-dot" /> bematist
          </div>
          <div className="chrome-right">{sectionLabel}</div>
        </div>
      ) : null}
      <div className="slide-body">{children}</div>
      <div className="pagenum-left">{leftFoot}</div>
      <div className="pagenum">
        {pad} <span className="total">/ {padTotal}</span>
      </div>
    </div>
  );
}

export function BSymbol({
  color = "currentColor",
  className,
  style,
}: {
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="57 34 48 64" className={className} style={{ color, ...style }} aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M58.2 49c0.4-6.4 5.6-12.6 12.6-12.9h18.6c7.4 0.1 12.8 5.7 12.8 13.3v5.1c-0.3 3.4-1.7 6.2-4.5 8.4 2.5 1.5 4.6 3.9 4.8 7.4v7.2c-0.4 5.7-4.6 10.9-11.5 11.3h-19.8v8.2h-13v-48zM61.3 49.5v44.4h6.7v-8.5h22.1c5.1 0 9-3.7 9.3-8.2v-6.4c-0.1-4.2-4.7-5.9-8.9-7.7 3.8-1.2 8.3-3.7 8.7-8.9v-4.7c-0.1-5-4.3-10.3-10.5-10.3h-17.1c-4.6 0-10 3.8-10.3 9.7v0.6zM68.1 48.9c0.1-2 1.4-3.2 3.3-3.2h15.9c2.8 0 5.1 1.6 5.2 4.5v3.8c-0.1 2.9-2.2 4.8-4.9 4.9h-6.9v6.6h6.2c3 0.1 5.7 1.8 5.9 5.2v5.3c-0.2 1.6-1.2 3-3.3 3h-21.4v-30.1zM71.2 76.2h17.8c0.4 0 0.6-0.2 0.7-0.5v-4.6c-0.1-1.5-1.2-2.6-3-2.6h-9.1v-12.7h9.6c1.2 0 2-0.7 2.1-1.8v-3.5c0-1.1-0.9-1.9-2.1-1.9h-15.4c-0.4 0-0.7 0.3-0.6 0.7v26.9z"
      />
    </svg>
  );
}
