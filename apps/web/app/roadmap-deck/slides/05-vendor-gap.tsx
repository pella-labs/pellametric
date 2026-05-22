import { SlideShell } from "../../deck/components/slide-shell";

const COLS = ["Per-engineer", "Per-PR", "Cross-tool", "Outcome-linked"];

const VENDORS = [
  { name: "Anthropic Console", logo: "/claudecode-color.svg" },
  { name: "OpenAI Platform", logo: "/codex-color.svg" },
  { name: "Cursor Admin", logo: null },
  { name: "GitHub Copilot", logo: null },
];

export function Slide05VendorGap({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell
      sectionLabel="04 / WHY VENDORS CAN'T SHOW YOU THIS"
      totalPages={totalPages}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 36,
          flex: 1,
          minHeight: 0,
          justifyContent: "center",
        }}
      >
        <h2 className="title" style={{ maxWidth: 1700, fontSize: 64 }}>
          Every vendor shows their slice.{" "}
          <em className="warm">None show your team.</em>
        </h2>

        <div
          style={{
            border: "1px solid var(--border)",
            background: "var(--bg-elev)",
          }}
        >
          {/* Header row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.3fr repeat(4, 1fr)",
              padding: "20px 28px",
              borderBottom: "1px solid var(--border)",
              fontFamily: "var(--f-mono)",
              fontSize: 14,
              color: "var(--ink-faint)",
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              background: "var(--bg)",
            }}
          >
            <span></span>
            {COLS.map((c) => (
              <span key={c} style={{ textAlign: "center" }}>
                {c}
              </span>
            ))}
          </div>

          {/* Vendor rows */}
          {VENDORS.map((v, i) => (
            <div
              key={v.name}
              style={{
                display: "grid",
                gridTemplateColumns: "1.3fr repeat(4, 1fr)",
                padding: "26px 28px",
                borderBottom:
                  i < VENDORS.length - 1 ? "1px dashed var(--border)" : "none",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {v.logo ? (
                  <img
                    src={v.logo}
                    alt=""
                    aria-hidden
                    style={{ width: 28, height: 28 }}
                  />
                ) : (
                  <span style={{ width: 28, height: 28 }} />
                )}
                <span
                  style={{
                    fontFamily: "var(--f-head)",
                    fontSize: 24,
                    color: "var(--ink)",
                    letterSpacing: "-0.015em",
                    fontWeight: 500,
                  }}
                >
                  {v.name}
                </span>
              </div>
              {COLS.map((c) => (
                <span
                  key={c}
                  style={{
                    textAlign: "center",
                    fontFamily: "var(--f-sys)",
                    fontSize: 32,
                    color: "var(--warm)",
                    opacity: 0.7,
                  }}
                >
                  ✗
                </span>
              ))}
            </div>
          ))}

          {/* Pellametric row — emphasized */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.3fr repeat(4, 1fr)",
              padding: "32px 28px",
              borderTop: "2px solid var(--accent)",
              alignItems: "center",
              background: "rgba(110, 138, 111, 0.08)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <img
                src="/primary-logo.svg"
                alt=""
                aria-hidden
                style={{ width: 32, height: 32 }}
              />
              <span
                style={{
                  fontFamily: "var(--f-head)",
                  fontSize: 28,
                  color: "var(--ink)",
                  letterSpacing: "-0.02em",
                  fontWeight: 500,
                }}
              >
                Pellametric
              </span>
            </div>
            {COLS.map((c) => (
              <span
                key={c}
                style={{
                  textAlign: "center",
                  fontFamily: "var(--f-sys)",
                  fontSize: 36,
                  color: "var(--accent)",
                  fontWeight: 700,
                }}
              >
                ✓
              </span>
            ))}
          </div>
        </div>
      </div>
    </SlideShell>
  );
}
