import { SlideShell } from "../../deck/components/slide-shell";

const TICKER = [
  { label: "Cursor", value: "$1M → $500M+ ARR" },
  { label: "Anthropic API", value: "$1B+ run rate" },
  { label: "GitHub Copilot", value: "1.3M+ paid seats" },
];

export function Slide02Hook({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="02 / THE HOOK" totalPages={totalPages}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div className="sys" style={{ color: "var(--ink-faint)" }}>
          Jensen Huang · NVIDIA CEO
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 48,
          }}
        >
          <div
            style={{
              fontFamily: "var(--f-sys)",
              fontSize: 360,
              color: "var(--accent)",
              letterSpacing: "-0.06em",
              lineHeight: 0.85,
              fontWeight: 700,
            }}
          >
            $200K
          </div>
          <div
            className="title"
            style={{
              fontSize: 64,
              lineHeight: 1.05,
              maxWidth: 1500,
            }}
          >
            per engineer, per year.{" "}
            <span className="muted">On tokens.</span>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            borderTop: "1px solid var(--border)",
            paddingTop: 24,
            fontFamily: "var(--f-mono)",
            fontSize: 18,
            color: "var(--ink-muted)",
          }}
        >
          {TICKER.map((t) => (
            <div
              key={t.label}
              style={{ display: "flex", flexDirection: "column", gap: 4 }}
            >
              <span
                style={{
                  fontSize: 13,
                  color: "var(--ink-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.16em",
                }}
              >
                {t.label}
              </span>
              <span style={{ color: "var(--ink)" }}>{t.value}</span>
            </div>
          ))}
        </div>
      </div>
    </SlideShell>
  );
}
