"use client";

import { CardMount } from "../../(marketing)/_card/CardMount";
import { DEMO_CARD } from "../../(marketing)/_card/demo-data";

// `bematist.dev/intro` is a 302 to the founders' Google Calendar booking
// page. Going through our own domain keeps the slide URL short + memorable
// and lets us swap the destination later without re-printing anything.
const SCHEDULE_LINK = "https://bematist.dev/intro";
const CARD_LINK = "https://bematist.dev/card";

/**
 * Closing slide — unified "let's build this together" pitch.
 *
 * Single audience, single headline. Both CTAs stack on the left; the card
 * on the right is hero art — rotated, oversized, bleeding past the right
 * edge — not a comparison panel. The card *is* the proof.
 */
export function Slide12ClosingCta(_props: { totalPages: number }) {
  return (
    <div
      className="slide"
      style={{ padding: 0, height: "100%", position: "relative", overflow: "hidden" }}
    >
      <div className="grid-bg" />

      <div className="chrome-row">
        <div className="wordmark">
          <span className="wordmark-dot" /> bematist
        </div>
        <div className="chrome-right">05 / GET STARTED</div>
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.15fr)",
          gap: 72,
          alignItems: "stretch",
          padding: "96px 0 96px 96px",
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
            justifyContent: "center",
            gap: 72,
            minHeight: 0,
            position: "relative",
            zIndex: 3,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <h2
              style={{
                fontSize: 112,
                lineHeight: 0.98,
                margin: 0,
                letterSpacing: "-0.03em",
                fontFamily: "var(--f-head)",
                fontWeight: 500,
                maxWidth: 820,
              }}
            >
              Measure{" "}
              <em
                style={{
                  color: "var(--accent)",
                  fontStyle: "italic",
                  fontWeight: 500,
                }}
              >
                AI development
              </em>
              .
            </h2>

            <p
              style={{
                fontSize: 28,
                lineHeight: 1.45,
                color: "var(--ink-muted)",
                margin: 0,
                maxWidth: 720,
              }}
            >
              <span style={{ color: "var(--ink)" }}>See the work.</span>{" "}
              <span style={{ color: "var(--ink)" }}>Find the friction.</span>{" "}
              <span style={{ color: "var(--ink)" }}>Track the return.</span>
            </p>
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
              href={SCHEDULE_LINK}
              label="bematist.dev/intro →"
              description="For engineering leaders: map bottlenecks, workflows, and AI spend."
              tone="warm"
            />
            <CtaButton
              href={CARD_LINK}
              label="bematist.dev/card →"
              description="For Claude Code and Codex users: claim your card today."
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
  const bg = isGhost ? "transparent" : tone === "accent" ? "var(--accent)" : "var(--warm)";
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
