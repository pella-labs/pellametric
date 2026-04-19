"use client";

import { cn } from "@bematist/ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

const WINDOWS = ["7d", "30d", "90d"] as const;
type Win = (typeof WINDOWS)[number];

const LABELS: Record<Win, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

export function WindowPicker({ value }: { value: Win }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function onChange(next: Win) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("window", next);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span>Window</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Win)}
        disabled={isPending}
        aria-label="Sessions time window"
        className={cn(
          "h-8 rounded-md border border-border bg-background px-2.5 py-1 pr-7 font-medium text-foreground",
          "cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        {WINDOWS.map((w) => (
          <option key={w} value={w}>
            {LABELS[w]}
          </option>
        ))}
      </select>
    </label>
  );
}
