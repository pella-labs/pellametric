import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-[var(--color-surface-muted)]",
        className,
      )}
      role="status"
      aria-busy="true"
      {...props}
    />
  );
}
