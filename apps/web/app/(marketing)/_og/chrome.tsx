import type { CSSProperties, ReactNode } from "react";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png" as const;

export const OG_COLORS = {
  bg: "#0a0b0d",
  bgElevated: "#111316",
  ink: "#ede8de",
  inkMuted: "rgba(237,232,222,0.6)",
  inkFaint: "rgba(237,232,222,0.3)",
  border: "rgba(237,232,222,0.12)",
  accent: "#6e8a6f",
  accentSoft: "rgba(110,138,111,0.18)",
  warm: "#b07b3e",
} as const;

const baseFont: CSSProperties = {
  fontFamily:
    '"Inter", "Helvetica Neue", "system-ui", -apple-system, sans-serif',
};

const monoFont: CSSProperties = {
  fontFamily:
    '"JetBrains Mono", "Menlo", "ui-monospace", "SFMono-Regular", monospace',
};

/**
 * Background grid — soft, large-spaced so it reads as texture rather than
 * a ruled page. Keep the cell size ≥ 80px and keep opacity low.
 */
const grid: CSSProperties = {
  backgroundColor: OG_COLORS.bg,
  backgroundImage: `linear-gradient(to right, rgba(237,232,222,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(237,232,222,0.04) 1px, transparent 1px)`,
  backgroundSize: "96px 96px",
};

/**
 * Soft accent glow in one corner — gives the canvas depth without
 * needing decorative artwork.
 */
const glow: CSSProperties = {
  position: "absolute",
  top: -240,
  right: -180,
  width: 720,
  height: 720,
  borderRadius: 9999,
  background: `radial-gradient(circle, ${OG_COLORS.accentSoft} 0%, transparent 70%)`,
  filter: "blur(40px)",
  display: "flex",
};

export function OgFrame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        ...baseFont,
        ...grid,
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        color: OG_COLORS.ink,
        position: "relative",
        padding: 72,
      }}
    >
      <div style={glow} />
      {/* Top bar — accent tile + wordmark. Matches the deck slide-01
          chrome. No right-side slug, no footer. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
        }}
      >
        <svg
          width={36}
          height={36}
          viewBox="0 0 120 125"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: "flex" }}
        >
          <path
            fill={OG_COLORS.accent}
            d="M75.288 0H8.988C8.488 0 7.788 0.5 7.788 1.1V23.4C7.788 23.9 8.188 24.6 8.888 24.6H73.988C79.288 24.6 84.088 26.3 87.388 28.9C92.088 32.6 94.588 37.9 94.588 43.6C95.088 54.1 87.288 62.8 77.888 64.7C76.088 65.3 72.888 66.3 61.588 66.3C61.188 66.3 60.688 66.6 60.488 67L50.488 90.6C50.188 91.2 50.688 92 51.388 92H73.188C81.288 92 88.888 90.8 95.988 87.2C105.488 82.4 119.288 70.7 119.288 48.3C119.388 25.8 104.388 11.4 92.988 4.2C87.188 1.4 82.388 0.2 75.288 0Z"
          />
          <path
            fill={OG_COLORS.accent}
            d="M73.488 32.6H40.188C39.788 32.6 39.288 32.9 39.088 33.4L0.088 123.3C-0.212 124.1 0.288 124.9 1.088 124.9H26.688C27.188 124.9 27.688 124.6 27.788 124.2L54.988 59.1C55.188 58.7 55.588 58.3 55.988 58.3H73.488C81.188 58.3 86.488 53.2 86.588 46.2C86.788 39 81.588 32.6 73.488 32.6Z"
          />
          <path
            fill={OG_COLORS.accent}
            d="M75.488 0H8.988C8.488 0 7.788 0.5 7.788 1.1V23.4C7.788 23.9 8.188 24.6 8.888 24.6H73.988C85.288 24.6 94.588 33 94.588 45.2C94.588 55.4 87.288 66.3 72.988 66.3H61.588C61.088 66.3 60.688 66.6 60.488 67L50.488 90.6C50.188 91.2 50.688 92 51.388 92H73.188C95.988 92 119.288 77.5 119.288 45.7C119.288 22.6 100.388 0.5 75.488 0Z"
          />
          <path
            fill={OG_COLORS.accent}
            d="M38.888 33.8L0.088 123.3C-0.212 124 0.288 124.8 1.088 124.8H26.588C27.088 124.8 27.588 124.5 27.688 124.1L54.988 59.1C55.188 58.7 55.588 58.3 55.988 58.3H73.488C81.188 58.3 86.588 53.1 86.588 45.6C86.588 38.9 81.988 32.6 73.488 32.6H40.088C39.588 32.6 39.088 33 38.888 33.8Z"
          />
        </svg>
        <span
          style={{
            color: OG_COLORS.ink,
            letterSpacing: "-0.02em",
            fontFamily: '"Inter", "Helvetica Neue", "system-ui", sans-serif',
            fontSize: 34,
            fontWeight: 700,
            display: "flex",
          }}
        >
          Telemetryc
        </span>
      </div>

      {children}
    </div>
  );
}

export function OgHeadline({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: 56,
        gap: 20,
        maxWidth: 960,
      }}
    >
      {eyebrow ? (
        <div
          style={{
            ...monoFont,
            fontSize: 14,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: OG_COLORS.accent,
          }}
        >
          {eyebrow}
        </div>
      ) : null}
      <div
        style={{
          fontSize: 72,
          fontWeight: 600,
          lineHeight: 1.02,
          letterSpacing: "-0.035em",
          color: OG_COLORS.ink,
          display: "flex",
        }}
      >
        {title}
      </div>
      {description ? (
        <div
          style={{
            fontSize: 24,
            lineHeight: 1.3,
            color: OG_COLORS.inkMuted,
            maxWidth: 820,
            display: "flex",
          }}
        >
          {description}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Deck-style cover — big wordmark + short tagline. Minimal keynote tone.
 * Vertically centered inside the OgFrame's flex column.
 */
export function OgCover({
  title,
  beats,
}: {
  title: ReactNode;
  beats?: string[];
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 36,
        flex: 1,
        maxWidth: 1040,
      }}
    >
      <div
        style={{
          fontSize: 176,
          fontWeight: 600,
          lineHeight: 0.95,
          letterSpacing: "-0.05em",
          color: OG_COLORS.ink,
          display: "flex",
        }}
      >
        {title}
      </div>
      {beats && beats.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            fontSize: 44,
            lineHeight: 1.2,
            color: OG_COLORS.inkMuted,
          }}
        >
          {beats.map((b, i) => (
            <span
              key={b}
              style={{
                color:
                  i === beats.length - 1 ? OG_COLORS.accent : OG_COLORS.ink,
                fontStyle: i === beats.length - 1 ? "italic" : "normal",
                display: "flex",
                marginRight: i === beats.length - 1 ? 0 : 20,
              }}
            >
              {b}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function OgStatRow({
  stats,
}: {
  stats: { label: string; value: string }[];
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        marginTop: 28,
        flexWrap: "wrap",
      }}
    >
      {stats.map((s) => (
        <div
          key={s.label}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "12px 18px",
            border: `1px solid ${OG_COLORS.border}`,
            background: "rgba(17,19,22,0.6)",
            borderRadius: 8,
            minWidth: 170,
          }}
        >
          <span
            style={{
              ...monoFont,
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: OG_COLORS.inkFaint,
            }}
          >
            {s.label}
          </span>
          <span
            style={{
              fontSize: 24,
              fontWeight: 600,
              color: OG_COLORS.ink,
              letterSpacing: "-0.02em",
            }}
          >
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}
