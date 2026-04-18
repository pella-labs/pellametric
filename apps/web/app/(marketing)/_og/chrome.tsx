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
  fontFamily: '"Inter", "Helvetica Neue", "system-ui", -apple-system, sans-serif',
};

const monoFont: CSSProperties = {
  fontFamily: '"JetBrains Mono", "Menlo", "ui-monospace", "SFMono-Regular", monospace',
};

/**
 * Background grid — vertical 24px lines drawn with a repeating linear
 * gradient. No SVG, no images: keeps ImageResponse fully self-contained.
 */
const grid: CSSProperties = {
  backgroundColor: OG_COLORS.bg,
  backgroundImage: `linear-gradient(to right, ${OG_COLORS.border} 1px, transparent 1px), linear-gradient(to bottom, ${OG_COLORS.border} 1px, transparent 1px)`,
  backgroundSize: "48px 48px",
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

export function OgFrame({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
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
        padding: 64,
      }}
    >
      <div style={glow} />
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          fontSize: 14,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          ...monoFont,
          color: OG_COLORS.inkMuted,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: OG_COLORS.bgElevated,
              border: `1px solid ${OG_COLORS.accent}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: OG_COLORS.accent,
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: 0,
              ...monoFont,
            }}
          >
            B
          </div>
          <span style={{ color: OG_COLORS.ink, letterSpacing: "0.22em" }}>bematist</span>
        </div>
        <span>{eyebrow}</span>
      </div>

      {children}

      {/* Bottom rule + footer */}
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          paddingTop: 24,
          borderTop: `1px solid ${OG_COLORS.border}`,
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
          fontSize: 13,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: OG_COLORS.inkFaint,
          ...monoFont,
        }}
      >
        <span>open-source · apache 2.0</span>
        <span>bematist.dev</span>
      </div>
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
        marginTop: 88,
        gap: 28,
        maxWidth: 980,
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
          fontSize: 84,
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
            fontSize: 28,
            lineHeight: 1.35,
            color: OG_COLORS.inkMuted,
            maxWidth: 880,
            display: "flex",
          }}
        >
          {description}
        </div>
      ) : null}
    </div>
  );
}

export function OgStatRow({ stats }: { stats: { label: string; value: string }[] }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        marginTop: 40,
        flexWrap: "wrap",
      }}
    >
      {stats.map((s) => (
        <div
          key={s.label}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "16px 22px",
            border: `1px solid ${OG_COLORS.border}`,
            background: "rgba(17,19,22,0.6)",
            borderRadius: 8,
            minWidth: 180,
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
              fontSize: 26,
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
