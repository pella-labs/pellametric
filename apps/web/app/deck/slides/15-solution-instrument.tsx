import { SlideShell } from "../components/slide-shell";

const BULLETS = [
  "Aggregate Prompts, Calls & Costs",
  "Measure Impact & Efficiency",
  "Track Outcomes & ROI",
];

export function Slide15SolutionInstrument({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="03 / THE SOLUTION" pageNumber={4} totalPages={totalPages}>
      <div className="eyebrow">03 / THE SOLUTION</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 96,
          alignItems: "center",
          flex: 1,
          fontFamily: "var(--f-sys)",
        }}
      >
        {/* Left column ----------------------------------------------------- */}
        <div style={{ maxWidth: 720 }}>
          <h2
            style={{
              display: "flex",
              flexDirection: "column",
              fontFamily: "var(--f-sys)",
              fontSize: 96,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
              margin: 0,
              fontWeight: 700,
            }}
          >
            <span style={{ color: "var(--ink)" }}>Transform</span>
            <span style={{ color: "#9ba98f", fontStyle: "italic" }}>
              AI Telemetry
              <span style={{ color: "var(--ink)", fontStyle: "normal" }}>.</span>
            </span>
          </h2>

          <p
            style={{
              marginTop: 28,
              fontSize: 32,
              color: "var(--ink-muted)",
              fontWeight: 300,
              lineHeight: 1.3,
              maxWidth: 620,
            }}
          >
            One unified dashboard for real insights.
          </p>

          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "56px 0 64px",
              display: "flex",
              flexDirection: "column",
              gap: 22,
              fontSize: 22,
            }}
          >
            {BULLETS.map((text) => (
              <li key={text} style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
                <span style={{ color: "#b88954", opacity: 0.85, marginTop: 2 }}>$&gt;</span>
                <span style={{ color: "#d4d4d8" }}>{text}</span>
              </li>
            ))}
          </ul>

          <div
            style={{
              borderTop: "1px solid rgba(39, 39, 42, 0.85)",
              paddingTop: 24,
              width: "80%",
            }}
          >
            <p
              style={{
                fontSize: 18,
                color: "var(--ink-muted)",
                fontStyle: "italic",
                letterSpacing: "0.02em",
                margin: 0,
              }}
            >
              {"// From raw data to real decisions."}
            </p>
          </div>
        </div>

        {/* Right column — Live Streams card -------------------------------- */}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
          <div
            style={{
              width: 680,
              background: "rgba(18, 18, 20, 0.95)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(39, 39, 42, 0.85)",
              borderRadius: 40,
              padding: 52,
              position: "relative",
              overflow: "hidden",
              boxShadow: "0 40px 100px -30px rgba(0, 0, 0, 0.95)",
            }}
          >
            {/* Top sheen */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "50%",
                background: "linear-gradient(to bottom, rgba(255,255,255,0.03), transparent)",
                pointerEvents: "none",
              }}
            />

            {/* Header row */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 40,
                position: "relative",
              }}
            >
              <h3
                style={{
                  fontSize: 14,
                  letterSpacing: "0.2em",
                  color: "var(--ink)",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  margin: 0,
                }}
              >
                Live Streams
              </h3>
              <div
                style={{
                  border: "1px solid rgba(184, 137, 84, 0.4)",
                  color: "#b88954",
                  padding: "6px 14px",
                  borderRadius: 999,
                  fontSize: 11,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  background: "rgba(184, 137, 84, 0.12)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  className="deck-pulse-dot"
                  aria-hidden
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "#b88954",
                    display: "inline-block",
                  }}
                />
                Capturing
              </div>
            </div>

            {/* Oscilloscope */}
            <div
              style={{
                height: 150,
                marginBottom: 32,
                borderBottom: "1px solid rgba(39, 39, 42, 0.5)",
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              <svg
                viewBox="0 0 400 100"
                className="deck-osc-glow"
                style={{ width: "100%", height: "100%" }}
                aria-hidden
                role="img"
              >
                <title>Live token stream waveform</title>
                <path
                  d="M 0 50 Q 25 10 50 50 T 100 50 T 150 50 T 200 50 T 250 50 T 300 50 T 350 50 T 400 50"
                  fill="none"
                  stroke="#9ba98f"
                  strokeWidth={2}
                  className="deck-waveform-path"
                  opacity={0.3}
                />
                <path
                  d="M 0 50 C 20 20, 40 80, 60 50 S 100 20, 140 50 S 180 80, 220 50 S 260 20, 300 50 S 340 80, 400 50"
                  fill="none"
                  stroke="#9ba98f"
                  strokeWidth={1.5}
                  className="deck-waveform-path"
                />
              </svg>
            </div>

            {/* Big stat */}
            <div style={{ marginBottom: 44 }}>
              <h2
                style={{
                  fontSize: 88,
                  letterSpacing: "-0.02em",
                  color: "var(--ink)",
                  fontWeight: 400,
                  margin: "0 0 8px",
                  lineHeight: 1,
                }}
              >
                142.8M
              </h2>
              <p
                style={{
                  fontSize: 16,
                  color: "var(--ink-muted)",
                  letterSpacing: "0.02em",
                  margin: 0,
                }}
              >
                Total tokens processed
              </p>
            </div>

            {/* Inline stats row */}
            <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <svg
                    width={18}
                    height={18}
                    fill="none"
                    stroke="#b88954"
                    strokeWidth={2}
                    viewBox="0 0 24 24"
                    aria-hidden
                    role="img"
                  >
                    <title>latency</title>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  <span style={{ color: "#b88954", fontSize: 20 }}>42ms</span>
                </div>
                <p
                  style={{
                    fontSize: 11,
                    color: "var(--ink-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.15em",
                    margin: 0,
                  }}
                >
                  Avg Latency
                </p>
              </div>
              <div style={{ width: 1, height: 32, background: "rgba(39, 39, 42, 0.85)" }} />
              <div>
                <div style={{ marginBottom: 4 }}>
                  <span style={{ color: "var(--ink)", fontSize: 20 }}>$1,240</span>
                </div>
                <p
                  style={{
                    fontSize: 11,
                    color: "var(--ink-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.15em",
                    margin: 0,
                  }}
                >
                  Est. Cost / 24h
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}
