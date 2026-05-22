"use client";

import { CardMount } from "../../(marketing)/_card/CardMount";
import { DEMO_CARD } from "../../(marketing)/_card/demo-data";
import { SlideShell } from "../../deck/components/slide-shell";

const FUNNEL = [
  "Dev runs /card",
  "Posts on X / Discord",
  "Manager clicks through",
  "Pilot. Repeat ×1,000.",
];

export function Slide09SoloCards({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell
      sectionLabel="07 / SOLO DEV CARDS"
      totalPages={totalPages}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1 }}>
        <h2 className="title" style={{ maxWidth: 1620 }}>
          The growth loop is{" "}
          <em className="accent">a card devs want to post</em>.
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.1fr",
            gap: 56,
            alignItems: "center",
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* Real CardMount */}
          <div
            className="deck-card-host"
            style={{
              position: "relative",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: "-80px",
                background:
                  "radial-gradient(circle at 50% 50%, rgba(176,123,62,0.18), transparent 55%), radial-gradient(circle at 30% 75%, rgba(110,138,111,0.14), transparent 60%)",
                filter: "blur(30px)",
                zIndex: 0,
              }}
            />
            <div
              style={{
                position: "relative",
                zIndex: 2,
                width: 420,
                transform: "scale(1.35)",
                transformOrigin: "center center",
                filter: "drop-shadow(0 40px 80px rgba(0, 0, 0, 0.6))",
              }}
            >
              <CardMount demoData={DEMO_CARD} compact autoAdvanceMs={5000} />
            </div>
          </div>

          {/* Funnel — 4 numbered steps */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            <div className="sys" style={{ color: "var(--ink-faint)" }}>
              The viral funnel
            </div>
            {FUNNEL.map((step, i) => (
              <div
                key={step}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr",
                  columnGap: 28,
                  alignItems: "center",
                  borderBottom: "1px dashed var(--border)",
                  paddingBottom: 16,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--f-sys)",
                    fontSize: 56,
                    color: "var(--accent)",
                    letterSpacing: "-0.025em",
                    lineHeight: 1,
                    minWidth: 72,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  style={{
                    fontFamily: "var(--f-head)",
                    fontSize: 32,
                    color: "var(--ink)",
                    letterSpacing: "-0.015em",
                    fontWeight: 500,
                    lineHeight: 1.15,
                  }}
                >
                  {step}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SlideShell>
  );
}
