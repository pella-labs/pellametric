import { SlideShell } from "../components/slide-shell";

export function Slide09Outcomes({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="07 / OUTCOMES" pageNumber={9} totalPages={totalPages}>
      <div className="eyebrow">07 / WHAT YOU GET</div>
      <h2 className="title" style={{ fontSize: 72 }}>
        A single view: outcomes and <em>efficiency</em>.
      </h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.1fr 1fr",
          gap: 32,
          marginTop: 48,
          flex: 1,
          minHeight: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              border: "1px solid var(--border)",
              padding: "28px 32px",
              background: "var(--bg-elev)",
              display: "flex",
              alignItems: "center",
              gap: 32,
            }}
          >
            <div
              style={{
                fontFamily: "var(--f-sys)",
                fontSize: 88,
                lineHeight: 0.95,
                color: "var(--accent)",
                letterSpacing: "-0.04em",
                flexShrink: 0,
              }}
            >
              14.2×
            </div>
            <div>
              <div className="sys" style={{ marginBottom: 8 }}>
                Outcome metric
              </div>
              <div
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 22,
                  color: "var(--ink-muted)",
                  lineHeight: 1.4,
                }}
              >
                <span className="ink" style={{ fontWeight: 500 }}>
                  accepted edits per dollar.
                </span>{" "}
                Dedup on (session, hunk). Reverts within 24h subtract.
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, flex: 1 }}>
            {[
              {
                n: "01",
                h: "Real-time insights",
                p: "Hourly alerts when a session strays from expectations.",
              },
              {
                n: "02",
                h: "Actionable learning",
                p: "Weekly digest highlights successful patterns worth adopting.",
              },
              {
                n: "03",
                h: "Zero leaderboards",
                p: "Privacy-first by design. The data was always yours.",
              },
              {
                n: "04",
                h: "Self-hostable",
                p: "Apache 2.0. Run against your coding agents in minutes.",
              },
            ].map((f) => (
              <div
                key={f.n}
                style={{
                  border: "1px solid var(--border)",
                  padding: "24px 28px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <span className="feature-index">{f.n}</span>
                <h3
                  style={{
                    fontFamily: "var(--f-sys)",
                    fontSize: 26,
                    color: "var(--ink)",
                    margin: 0,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {f.h}
                </h3>
                <p
                  style={{
                    margin: 0,
                    fontSize: 20,
                    color: "var(--ink-muted)",
                    lineHeight: 1.4,
                  }}
                >
                  {f.p}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            border: "1px solid var(--border)",
            background: "var(--bg-elev)",
            padding: "32px 40px",
          }}
        >
          <span className="sys">What the dashboard shows</span>
          <ul className="kv" style={{ marginTop: 20, fontSize: 20 }}>
            <li>
              <span>/summary</span>
              <span className="ink">spend · accepted edits · $/PR</span>
            </li>
            <li>
              <span>/sessions</span>
              <span className="ink">every session, tokens, tools</span>
            </li>
            <li>
              <span>/outcomes</span>
              <span className="ink">cost per merged PR, commit join</span>
            </li>
            <li>
              <span>/clusters</span>
              <span className="ink">similar prompts + twin finder</span>
            </li>
            <li>
              <span>/insights</span>
              <span className="ink">anomalies + weekly digest</span>
            </li>
          </ul>
        </div>
      </div>
    </SlideShell>
  );
}
