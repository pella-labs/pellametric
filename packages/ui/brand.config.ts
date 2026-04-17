/**
 * Bematist brand metadata.
 *
 * Visual tokens (colors, radii, fonts) live in `src/styles/theme.css` as
 * OKLCH custom properties (shadcn base-lyra style, zinc base color). This
 * file carries only identifying metadata and motion defaults — no colors —
 * so the CSS is the single source of truth for appearance.
 */

export const brand = {
  name: "Bematist",
  tagline: "AI engineering analytics",

  /** Motion durations (ms) — all paired with `prefers-reduced-motion: reduce`. */
  motion: {
    fast: 120,
    base: 200,
    slow: 360,
    /** Standard easing — closer to material than linear. */
    ease: [0.4, 0, 0.2, 1] as const,
  },
} as const;

/**
 * Names of Tailwind semantic color utilities available via `@theme inline`
 * in `theme.css`. Useful as a type for props that gate on semantic role.
 */
export type BrandColor =
  | "background"
  | "foreground"
  | "card"
  | "card-foreground"
  | "popover"
  | "popover-foreground"
  | "primary"
  | "primary-foreground"
  | "secondary"
  | "secondary-foreground"
  | "muted"
  | "muted-foreground"
  | "accent"
  | "accent-foreground"
  | "destructive"
  | "destructive-foreground"
  | "border"
  | "input"
  | "ring"
  | "positive"
  | "positive-foreground"
  | "warning"
  | "warning-foreground";
