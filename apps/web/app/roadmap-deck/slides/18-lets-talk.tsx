"use client";

export function Slide18LetsTalk(_props: { totalPages: number }) {
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
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(60% 50% at 30% 40%, rgba(110,138,111,0.18), transparent 60%), radial-gradient(45% 40% at 80% 80%, rgba(176,123,62,0.12), transparent 65%)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      <div className="chrome-row">
        <div className="wordmark">
          <img
            className="wordmark-dot"
            src="/primary-logo.svg"
            alt="Pellametric"
          />
        </div>
        <div className="chrome-right">13 / LET'S TALK</div>
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 2,
          padding: "192px 96px 96px",
          height: "100%",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 80,
        }}
      >
        <h2
          className="title"
          style={{
            margin: 0,
            fontSize: 144,
            lineHeight: 0.95,
            maxWidth: 1700,
          }}
        >
          Five seats open for{" "}
          <em className="accent">design partners</em>.
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 80,
            alignItems: "end",
            borderTop: "1px solid var(--border)",
            paddingTop: 48,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 16,
                color: "var(--ink-faint)",
                textTransform: "uppercase",
                letterSpacing: "0.18em",
              }}
            >
              Pilot
            </span>
            <span
              style={{
                fontFamily: "var(--f-head)",
                fontSize: 56,
                color: "var(--ink)",
                letterSpacing: "-0.025em",
                lineHeight: 1.05,
                fontWeight: 500,
              }}
            >
              60 days. $0.
              <br />
              Case study in return.
            </span>
          </div>

          <a
            href="https://pellametric.com/intro"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 8,
              padding: "32px 40px",
              background: "var(--warm)",
              color: "#0a0b0d",
              textDecoration: "none",
              justifySelf: "end",
              minWidth: 600,
            }}
          >
            <span
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 16,
                color: "rgba(10,11,13,0.65)",
                textTransform: "uppercase",
                letterSpacing: "0.18em",
              }}
            >
              Book a call
            </span>
            <span
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 44,
                fontWeight: 500,
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
              }}
            >
              pellametric.com/intro →
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}
