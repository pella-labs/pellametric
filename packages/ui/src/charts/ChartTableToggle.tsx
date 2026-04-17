"use client";

import { type ReactNode, useId, useState } from "react";
import { Button } from "../components/Button";

/**
 * Every chart has an a11y "view as table" toggle (CLAUDE.md Design Rules).
 *
 * Wrap the chart and provide the same data shaped as a table. The toggle is
 * keyboard-reachable and announces the mode change via aria-pressed.
 */
export function ChartTableToggle({
  chart,
  table,
  initial = "chart",
}: {
  chart: ReactNode;
  table: ReactNode;
  initial?: "chart" | "table";
}) {
  const [mode, setMode] = useState<"chart" | "table">(initial);
  const labelId = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={mode === "table"}
          aria-label={`Toggle view: currently ${mode}`}
          aria-labelledby={labelId}
          onClick={() => setMode((m) => (m === "chart" ? "table" : "chart"))}
        >
          <span id={labelId}>{mode === "chart" ? "View as table" : "View as chart"}</span>
        </Button>
      </div>
      <div>{mode === "chart" ? chart : table}</div>
    </div>
  );
}
