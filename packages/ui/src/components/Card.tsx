import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // min-w-0 lets cards shrink below their content's intrinsic width
        // inside flex/grid parents. Without it, a long CardValue (e.g.
        // "$11,474.46" at text-3xl) forces the card wider than its grid
        // track and overflows the viewport on narrow screens.
        "min-w-0 rounded-xl border border-border bg-card text-card-foreground p-5",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-3 flex flex-col gap-1", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-medium text-muted-foreground", className)} {...props} />;
}

export function CardValue({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // text-3xl doesn't fit a 5-digit dollar value inside a grid-cols-2
        // phone-width cell. Step down one tier under md so the number stays
        // fully readable instead of clipping mid-digit.
        "text-2xl md:text-3xl font-semibold text-foreground break-words tabular-nums",
        className,
      )}
      {...props}
    />
  );
}
