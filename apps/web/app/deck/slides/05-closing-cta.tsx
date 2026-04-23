"use client";

import { CardMount } from "../../(marketing)/_card/CardMount";
import { DEMO_CARD } from "../../(marketing)/_card/demo-data";

// `pellametric.com/intro` is a 302 to the founders' Google Calendar booking
// page. Going through our own domain keeps the slide URL short + memorable
// and lets us swap the destination later without re-printing anything.
const SCHEDULE_LINK = "https://pellametric.com/intro";
const CARD_LINK = "https://pellametric.com/card";

/**
 * Closing slide — unified "let's build this together" pitch.
 *
 * Single audience, single headline. Both CTAs stack on the left; the card
 * on the right is hero art — rotated, oversized, bleeding past the right
 * edge — not a comparison panel. The card *is* the proof.
 */
export function Slide05ClosingCta(_props: { totalPages: number }) {
  return (
    <div
      className="slide"
      style={{
        padding: 0,
        height: "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div className="grid-bg" />

      <div className="chrome-row">
        <div className="wordmark">
          <img
            className="wordmark-dot"
            src="/primary-logo.svg"
            alt="Pellametric"
          />
        </div>
        <div className="chrome-right">04 / VERDICT</div>
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.15fr)",
          gap: 72,
          alignItems: "stretch",
          padding: "192px 0 96px 96px",
          height: "100%",
          boxSizing: "border-box",
        }}
      >
        {/* LEFT — headline+subline as one block, CTAs as another, centered
            vertically in the column with a fixed gap so the text block
            optically lines up with the scaled card on the right instead
            of hugging the top of the slide. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-start",
            gap: 56,
            minHeight: 0,
            position: "relative",
            zIndex: 3,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <h2 className="title" style={{ margin: 0 }}>
              Every token, every tool, every repo.{" "}
              <span
                style={{
                  color: "var(--accent)",
                  fontWeight: 500,
                }}
              >
                Finally counted.
              </span>
            </h2>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 18,
              alignItems: "stretch",
              width: 640,
              maxWidth: "100%",
            }}
          >
            <CtaButton
              href={CARD_LINK}
              label="pellametric.com/card →"
              description="For Claude Code and Codex users: claim your card today."
              tone="warm"
            />
            <CtaButton
              href={SCHEDULE_LINK}
              label="pellametric.com/intro →"
              description="For engineering leaders: map bottlenecks, workflows, and AI spend."
              tone="ghost"
            />
          </div>
        </div>

        {/* RIGHT — card as hero art, big and centered in the column.
            `deck-card-host` tells deck.css to hide the CardMount side
            arrows + share bar so the only navigation surface is the
            deck's own chrome. */}
        <div
          className="deck-card-host"
          style={{
            position: "relative",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            paddingRight: 72,
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: "-120px -120px -120px -40px",
              background:
                "radial-gradient(circle at 50% 50%, rgba(176,123,62,0.22), transparent 55%), radial-gradient(circle at 30% 75%, rgba(110,138,111,0.16), transparent 60%)",
              filter: "blur(30px)",
              zIndex: 0,
            }}
          />
          {/* CardMount's compact scene is hard-capped at 380px wide in
              card.css; scaling the wrapper is the only way to actually
              enlarge it without forking the card component. */}
          <div
            style={{
              position: "relative",
              zIndex: 2,
              width: 420,
              transform: "scale(1.45)",
              transformOrigin: "center center",
              filter: "drop-shadow(0 40px 80px rgba(0, 0, 0, 0.6))",
            }}
          >
            <CardMount demoData={DEMO_CARD} compact autoAdvanceMs={5000} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * CTA pill. Three tones — accent (sage), warm (amber), ghost (outlined).
 * Primary CTA uses `warm`; secondary uses `ghost` so the two stacked CTAs
 * read as primary → secondary without the second button fighting for the
 * same visual weight.
 */
function CtaButton({
  href,
  label,
  description,
  tone,
}: {
  href: string;
  label: string;
  description: string;
  tone: "accent" | "warm" | "ghost";
}) {
  const isGhost = tone === "ghost";
  const bg = isGhost
    ? "transparent"
    : tone === "accent"
      ? "var(--accent)"
      : "var(--warm)";
  const fg = isGhost ? "var(--ink)" : "#0a0b0d";
  const border = isGhost ? "1px solid rgba(255, 255, 255, 0.18)" : "none";
  const descriptionColor = isGhost ? "var(--ink-muted)" : "rgba(10,11,13,0.72)";
  return (
    <a
      href={href}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 10,
        padding: "24px 32px",
        background: bg,
        color: fg,
        border,
        textDecoration: "none",
        width: "100%",
        boxSizing: "border-box",
        position: "relative",
        zIndex: 2,
      }}
    >
      <span
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: "-0.01em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 16,
          lineHeight: 1.4,
          color: descriptionColor,
        }}
      >
        {description}
      </span>
    </a>
  );
}
