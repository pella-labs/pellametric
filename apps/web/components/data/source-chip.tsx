// T4.6 — SourceChip: hue + glyph badge for AI source. Both encode (a11y).
import React from "react";

const META = {
  claude: { glyph: "◼", color: "var(--source-claude)", label: "Claude" },
  codex: { glyph: "▨", color: "var(--source-codex)", label: "Codex" },
  cursor: { glyph: "▦", color: "var(--source-cursor)", label: "Cursor" },
  human: { glyph: "◻", color: "var(--source-human)", label: "Human" },
  bot: { glyph: "⚙", color: "var(--muted-foreground)", label: "Bot" },
} as const;

export type SourceKind = keyof typeof META;

export function SourceChip({
  kind,
  size = "md",
  showLabel = false,
}: {
  kind: SourceKind;
  size?: "sm" | "md";
  showLabel?: boolean;
}): React.ReactElement {
  const m = META[kind];
  const sz = size === "sm" ? "text-[10px]" : "text-xs";
  return (
    <span className={`inline-flex items-center gap-1 ${sz}`} aria-label={m.label}>
      <span style={{ color: m.color }} aria-hidden="true">
        {m.glyph}
      </span>
      {showLabel && <span className="text-(--foreground)">{m.label}</span>}
    </span>
  );
}
