import { cn } from "@bematist/ui";

// Color-coded chip so Claude Code / Codex / Cursor / Goose are instantly
// distinguishable in dense tables — the source column is the fastest visual
// filter users have on a mixed-source list.

type SourceKey = "claude-code" | "codex" | "cursor" | "goose" | (string & {});

const TONE: Record<string, { label: string; tone: string }> = {
  "claude-code": {
    label: "Claude",
    tone: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  codex: {
    label: "Codex",
    tone: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  cursor: {
    label: "Cursor",
    tone: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  },
  goose: {
    label: "Goose",
    tone: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  },
};

export function SourceBadge({
  source,
  className,
  size = "sm",
}: {
  source: SourceKey;
  className?: string;
  size?: "sm" | "xs";
}) {
  const entry = TONE[source] ?? { label: source, tone: "bg-muted text-foreground border-border" };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border font-medium",
        size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        entry.tone,
        className,
      )}
    >
      {entry.label}
    </span>
  );
}

export function sourceLabel(key: SourceKey): string {
  return TONE[key]?.label ?? String(key);
}
