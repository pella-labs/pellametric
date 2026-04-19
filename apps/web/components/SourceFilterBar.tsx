import Link from "next/link";
import { SourceBadge } from "./SourceBadge";

export type FilterKey = "claude-code" | "codex" | "cursor";

const OPTIONS: { key: FilterKey; label: string }[] = [
  { key: "claude-code", label: "Claude" },
  { key: "codex", label: "Codex" },
  { key: "cursor", label: "Cursor" },
];

export function SourceFilterBar({
  basePath,
  current,
  extraParams = {},
}: {
  basePath: string;
  current: FilterKey | null;
  extraParams?: Record<string, string | undefined>;
}) {
  const mkHref = (source: FilterKey | null): string => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(extraParams)) {
      if (v) qs.set(k, v);
    }
    if (source) qs.set("source", source);
    const q = qs.toString();
    return q ? `${basePath}?${q}` : basePath;
  };

  const isActive = (key: FilterKey | null) => current === key;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">Source:</span>
      <Link
        href={mkHref(null)}
        className={`rounded px-2 py-0.5 border ${
          isActive(null)
            ? "bg-primary/15 border-primary/30 text-foreground"
            : "border-transparent hover:border-border text-muted-foreground"
        }`}
      >
        All sources
      </Link>
      {OPTIONS.map((o) => (
        <Link
          key={o.key}
          href={mkHref(o.key)}
          className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 border ${
            isActive(o.key)
              ? "bg-primary/15 border-primary/30"
              : "border-transparent hover:border-border"
          }`}
        >
          <SourceBadge source={o.key} size="xs" />
        </Link>
      ))}
    </div>
  );
}
