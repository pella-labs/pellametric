// F1.9 — EmptyState: design-council §6.3 prescribes 3 diagnostics + 2 escape
// hatches. Tone is informational, not apologetic. No illustrations or
// exclamation marks. The signature shape:
//
//   Nothing to attribute yet.
//   4 devs joined. 2 installed. 0 sessions matched merged PRs (7d)
//
//   Common causes:
//    ◯ Collectors not running                 [view setup]
//    ◯ Sessions linked to repos outside org   [review filter]
//    ◯ No PRs merged this week
//
//   Escape hatches: [Unmatched sessions] [All PRs (no attribution)]

import React from "react";
import Link from "next/link";

export type Diagnostic = {
  label: string;
  cta?: { href: string; label: string };
};

export type EscapeHatch = {
  href: string;
  label: string;
};

export function EmptyState({
  headline,
  summary,
  diagnostics,
  escapeHatches = [],
}: {
  headline: string;
  /**
   * One-line factual summary of the count situation.
   * e.g. "4 devs joined. 2 installed. 0 sessions matched merged PRs (7d)"
   */
  summary?: string;
  diagnostics: Diagnostic[];
  escapeHatches?: EscapeHatch[];
}): React.ReactElement {
  return (
    <div className="mk-panel space-y-6" role="status" aria-live="polite">
      <div className="space-y-1">
        <h3 className="mk-heading text-lg text-(--foreground)">{headline}</h3>
        {summary && <p className="mk-table-cell text-(--muted-foreground)">{summary}</p>}
      </div>

      {diagnostics.length > 0 && (
        <div className="space-y-2">
          <p className="mk-label">Common causes</p>
          <ul className="space-y-2">
            {diagnostics.map((d, i) => (
              <li key={i} className="flex items-start gap-3 mk-table-cell">
                <span aria-hidden="true" className="text-(--muted-foreground) mt-1">
                  ◯
                </span>
                <span className="flex-1 text-(--foreground)">{d.label}</span>
                {d.cta && (
                  <Link
                    href={d.cta.href}
                    className="text-(--accent) hover:underline mk-table-cell"
                  >
                    [{d.cta.label}]
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {escapeHatches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-(--border)">
          <span className="mk-label">Escape hatches</span>
          {escapeHatches.map((h, i) => (
            <Link
              key={i}
              href={h.href}
              className="mk-table-cell border border-(--border) hover:border-(--border-hover) px-2 py-1 rounded-[var(--radius)] text-(--foreground)"
            >
              {h.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
