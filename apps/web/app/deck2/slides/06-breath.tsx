/**
 * Slide 06 — 03:47 (silent breath).
 *
 * No headline, no caption, no section label. A laptop silhouette in the
 * dark with the faintest warm glow from the screen and a low-opacity
 * stream of mono text to suggest a Claude Code session running at
 * night. The timestamp in the corner is the only label. This slide is
 * meant to land quietly and hold.
 */
export function Slide06Breath(_props: { totalPages: number }) {
  return (
    <div
      className="slide"
      style={{
        padding: 0,
        position: "relative",
        height: "100%",
        background: "#050506",
        overflow: "hidden",
      }}
    >
      {/* Timestamp, top-right */}
      <div
        style={{
          position: "absolute",
          top: 56,
          right: 96,
          fontFamily: "var(--f-sys)",
          fontSize: 20,
          color: "rgba(237, 232, 222, 0.32)",
          letterSpacing: "0.12em",
          zIndex: 3,
        }}
      >
        03:47
      </div>

      {/* Ambient warm pool, suggesting a desk lamp off-frame. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 900px 600px at 50% 62%, rgba(176, 123, 62, 0.09), transparent 60%)",
        }}
      />

      {/* Laptop silhouette, CSS-only. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 900,
          height: 640,
        }}
      >
        {/* Screen bezel */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            transform: "translateX(-50%)",
            width: 820,
            height: 520,
            borderRadius: 14,
            background: "#0a0b0d",
            border: "1px solid rgba(237, 232, 222, 0.08)",
            boxShadow: "inset 0 0 80px rgba(0, 0, 0, 0.8)",
            overflow: "hidden",
          }}
        >
          {/* Glow layer */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(ellipse 60% 55% at 50% 55%, rgba(176, 123, 62, 0.16), transparent 70%)",
            }}
          />
          {/* Stream of dim mono text */}
          <div
            style={{
              position: "absolute",
              inset: "32px 40px",
              fontFamily: "var(--f-mono)",
              fontSize: 14,
              lineHeight: 1.9,
              color: "rgba(237, 232, 222, 0.14)",
              letterSpacing: "0.02em",
              overflow: "hidden",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {STREAM}
          </div>
          {/* Subtle scanline sheen */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background:
                "repeating-linear-gradient(180deg, rgba(255,255,255,0.012) 0 2px, transparent 2px 4px)",
              mixBlendMode: "overlay",
              pointerEvents: "none",
            }}
          />
        </div>

        {/* Hinge + deck */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 68,
            transform: "translateX(-50%)",
            width: 900,
            height: 22,
            background:
              "linear-gradient(180deg, rgba(237, 232, 222, 0.04), rgba(237, 232, 222, 0.01))",
            borderTop: "1px solid rgba(237, 232, 222, 0.05)",
            borderRadius: "0 0 8px 8px",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 50,
            transform: "translateX(-50%)",
            width: 140,
            height: 6,
            background: "rgba(237, 232, 222, 0.04)",
            borderRadius: "0 0 10px 10px",
          }}
        />
      </div>

      {/* Faint grid only, kept subtle to preserve the stillness. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.35,
          background:
            "linear-gradient(to right, rgba(237, 232, 222, 0.018) 1px, transparent 1px), linear-gradient(to bottom, rgba(237, 232, 222, 0.018) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// An impressionistic slice of a Claude Code session — not a real
// transcript, just the shape of one so the screen reads as "someone is
// mid-turn at 3am" rather than as decorative noise.
const STREAM = `> $ claude
  thinking…
  reading apps/web/app/api/ingest/route.ts
  reading apps/collector/src/config.ts
  grep -r "session_id" apps/web/lib
  edit apps/web/lib/crypto/prompts.ts:42
  running bun test
  ✓ encrypts with per-user DEK
  ✓ rejects read without master key
  ✓ round-trips 2048 prompts
  thinking…
  the zombie detector should sweep every 60s,
  mark idle > 2h, and surface them in the
  session list with a warm badge. no deletion
  — the file on disk is the ground truth.
  edit apps/web/app/api/sessions/route.ts:118
  running bun run typecheck
  ✓ 0 errors, 0 warnings
  commit feat(sessions): zombie sweep
  thinking…`;
