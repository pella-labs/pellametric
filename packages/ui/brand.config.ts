/**
 * Bematist brand tokens.
 *
 * These values are mirrored into CSS custom properties by `src/styles/theme.css`
 * (`@theme` block, Tailwind v4). Keep the two in sync when editing.
 *
 * Dark mode is the default per CLAUDE.md Design Rules. Light mode exists as a
 * progressive-enhancement for users who force it via system preference; we do
 * not ship a light-first variant.
 */

export const brand = {
  name: "Bematist",
  tagline: "AI engineering analytics",

  /** Semantic color roles. Hex values mirror the CSS vars in `theme.css`. */
  colors: {
    /** Page + primary surface. */
    background: "#0a0b0f",
    /** Raised cards, dialogs. */
    surface: "#12141a",
    /** Secondary surfaces, hover states. */
    surfaceMuted: "#1a1d25",
    /** Borders + dividers. */
    border: "#252933",
    /** Primary text. */
    foreground: "#e6e8ec",
    /** Secondary, lower-emphasis text. */
    foregroundMuted: "#9197a3",
    /** Brand accent — used sparingly for primary actions. */
    accent: "#6d8eff",
    accentForeground: "#0a0b0f",
    /** Positive, negative, warning — for tiles and chips. */
    positive: "#3ed598",
    negative: "#ff6b7a",
    warning: "#ffb547",
  },

  /** Type scale — matches Tailwind v4 defaults with slight tightening. */
  typography: {
    fontFamilySans:
      '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontFamilyMono:
      '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
  },

  /** Border radius — uniform, tight. */
  radius: {
    sm: "0.25rem",
    md: "0.5rem",
    lg: "0.75rem",
  },

  /** Motion — all keyed to `prefers-reduced-motion: reduce`. */
  motion: {
    /** Duration in ms when motion is allowed. */
    fast: 120,
    base: 200,
    slow: 360,
    /** Standard easing — closer to material than linear. */
    ease: [0.4, 0, 0.2, 1] as const,
  },
} as const;

export type BrandColor = keyof typeof brand.colors;
