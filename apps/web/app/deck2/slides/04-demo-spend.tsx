import { SlideShell } from "../components/slide-shell";

/**
 * Slide 04 — Demo handoff #1, spend.
 *
 * Mostly empty by design: the presenter cuts away to the live dashboard
 * here. We give the audience just enough to hold the thought and a
 * visible handoff affordance so they know the slide is the hinge, not
 * the destination.
 */
export function Slide04DemoSpend({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="04 / DEMO — SPEND" pageNumber={4} totalPages={totalPages}>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          minHeight: 0,
        }}
      >
        <h2 className="title" style={{ maxWidth: 1400 }}>
          Who's spending what. <em>Live.</em>
        </h2>

        <div
          style={{
            marginTop: 140,
            display: "flex",
            alignItems: "center",
            gap: 28,
            fontFamily: "var(--f-mono)",
            fontSize: 22,
            color: "var(--ink-faint)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          <span
            aria-hidden
            style={{
              fontFamily: "var(--f-sys)",
              fontSize: 64,
              color: "var(--accent)",
              lineHeight: 1,
              letterSpacing: "-0.04em",
            }}
          >
            →
          </span>
          <span>presenter: live dashboard</span>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 96,
          left: 96,
          fontFamily: "var(--f-mono)",
          fontSize: 18,
          color: "var(--ink-faint)",
          letterSpacing: "0.04em",
        }}
      >
        /org/pella · last 30 days · sorted tokensOut desc
      </div>
    </SlideShell>
  );
}
