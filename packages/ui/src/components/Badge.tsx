import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral:
          "bg-[var(--color-surface-muted)] text-[var(--color-foreground-muted)]",
        accent:
          "bg-[var(--color-accent)]/15 text-[var(--color-accent)]",
        positive:
          "bg-[var(--color-positive)]/15 text-[var(--color-positive)]",
        negative:
          "bg-[var(--color-negative)]/15 text-[var(--color-negative)]",
        warning:
          "bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
