import { SlideShell } from "../../deck/components/slide-shell";

// Vendor ARR bars (visual approximation — proportional, not exact to scale)
const BARS = [
  { label: "OpenAI API", value: "$4B+", pct: 100 },
  { label: "Anthropic API", value: "$2–3B", pct: 65 },
  { label: "Copilot", value: "$400M+", pct: 14 },
  { label: "Cursor", value: "$500M+", pct: 17 },
];

export function Slide03Market({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="03 / MARKET & PROBLEM" totalPages={totalPages}>
      <div style={{ display: "flex", flexDirection: "column", gap: 32, flex: 1 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.2fr",
            gap: 64,
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="sys" style={{ color: "var(--ink-faint)" }}>
              AI coding spend · 2026
            </div>
            <div
              style={{
                fontFamily: "var(--f-sys)",
                fontSize: 200,
                color: "var(--accent)",
                letterSpacing: "-0.06em",
                lineHeight: 0.9,
                fontWeight: 700,
              }}
            >
              $10B+
            </div>
            <div
              className="title"
              style={{ fontSize: 40, lineHeight: 1.1, maxWidth: 640 }}
            >
              Fastest-growing line in the engineering budget.
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              padding: "24px 28px",
              border: "1px solid var(--border)",
              background: "var(--bg-elev)",
            }}
          >
            <div className="sys" style={{ color: "var(--ink-faint)" }}>
              Vendor ARR · early 2026
            </div>
            {BARS.map((b) => (
              <div
                key={b.label}
                style={{
                  display: "grid",
                  gridTemplateColumns: "150px 1fr 130px",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--f-mono)",
                    fontSize: 16,
                    color: "var(--ink-muted)",
                  }}
                >
                  {b.label}
                </span>
                <div
                  style={{
                    height: 24,
                    background: "rgba(110, 138, 111, 0.12)",
                    border: "1px solid var(--border)",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      width: `${b.pct}%`,
                      background:
                        "linear-gradient(90deg, var(--accent), rgba(110, 138, 111, 0.6))",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: "var(--f-sys)",
                    fontSize: 24,
                    color: "var(--accent)",
                    letterSpacing: "-0.02em",
                    textAlign: "right",
                  }}
                >
                  {b.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            border: "1px solid var(--border)",
            background: "var(--bg-elev)",
            flex: 1,
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: "28px 36px",
              borderRight: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div className="sys" style={{ color: "var(--accent)" }}>
              The Manager
            </div>
            <div
              style={{
                fontFamily: "var(--f-head)",
                fontSize: 34,
                color: "var(--ink)",
                lineHeight: 1.15,
                fontWeight: 500,
                letterSpacing: "-0.02em",
              }}
            >
              Spend without signal.
            </div>
            <div
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 19,
                color: "var(--ink-muted)",
                lineHeight: 1.5,
              }}
            >
              $250–600K/yr on a 50-eng team. 30% of seats unused after week 2.
              No idea who's winning.
            </div>
          </div>
          <div
            style={{
              padding: "28px 36px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div className="sys" style={{ color: "var(--warm)" }}>
              The Engineer
            </div>
            <div
              style={{
                fontFamily: "var(--f-head)",
                fontSize: 34,
                color: "var(--ink)",
                lineHeight: 1.15,
                fontWeight: 500,
                letterSpacing: "-0.02em",
              }}
            >
              Work without feedback.
            </div>
            <div
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 19,
                color: "var(--ink-muted)",
                lineHeight: 1.5,
              }}
            >
              Hundreds of sessions a week. Which prompts shipped code? Logs are
              right there — unreadable.
            </div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}
