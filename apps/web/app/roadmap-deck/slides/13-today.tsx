import { SlideShell } from "../../deck/components/slide-shell";

const STATS = [
  { label: "Product", value: "Live" },
  { label: "Pilots", value: "1 + 5" },
  { label: "Code", value: "OSS" },
  { label: "Reach", value: "1,000s" },
];

const LIVE = [
  "GitHub + GitLab auth · org-scoped",
  "Cross-platform collector · 5 targets",
  "Manager dashboard · PR-level drill-down",
  "Solo dev cards · viral funnel",
];

const NEXT = [
  { owner: "Sandesh", item: "Multi-tenant cohort infrastructure" },
  { owner: "Sebastian", item: "LLM session analytics & benchmarks" },
  { owner: "Walid", item: "Instructor view + self-onboarding at 100+" },
  { owner: "David", item: "Trust page, signed releases, audit log" },
  { owner: "Alex", item: "GauntletAI launch + 5 design partner pipeline" },
];

export function Slide13Today({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell
      sectionLabel="11 / TODAY & NEXT QUARTER"
      totalPages={totalPages}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 36, flex: 1 }}>
        <h2 className="title" style={{ maxWidth: 1620 }}>
          Working product. <em className="accent">Real pipeline.</em>
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            border: "1px solid var(--border)",
            background: "var(--bg-elev)",
          }}
        >
          {STATS.map((s, i) => (
            <div
              key={s.label}
              style={{
                padding: "28px 32px",
                borderRight:
                  i < STATS.length - 1 ? "1px solid var(--border)" : "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 14,
                  color: "var(--ink-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.16em",
                }}
              >
                {s.label}
              </span>
              <span
                style={{
                  fontFamily: "var(--f-sys)",
                  fontSize: 56,
                  color: "var(--accent)",
                  letterSpacing: "-0.025em",
                  lineHeight: 1,
                }}
              >
                {s.value}
              </span>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 0,
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
              gap: 16,
            }}
          >
            <div className="sys" style={{ color: "var(--accent)" }}>
              What's live
            </div>
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {LIVE.map((item) => (
                <li
                  key={item}
                  style={{
                    fontFamily: "var(--f-mono)",
                    fontSize: 22,
                    color: "var(--ink)",
                    lineHeight: 1.4,
                    paddingLeft: 24,
                    position: "relative",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: 0,
                      color: "var(--accent)",
                    }}
                  >
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div
            style={{
              padding: "28px 36px",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div className="sys" style={{ color: "var(--warm)" }}>
              Next quarter
            </div>
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              {NEXT.map((row) => (
                <li
                  key={row.owner}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "100px 1fr",
                    columnGap: 16,
                    alignItems: "baseline",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--f-mono)",
                      fontSize: 13,
                      color: "var(--warm)",
                      textTransform: "uppercase",
                      letterSpacing: "0.14em",
                    }}
                  >
                    {row.owner}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--f-mono)",
                      fontSize: 20,
                      color: "var(--ink-muted)",
                      lineHeight: 1.4,
                    }}
                  >
                    {row.item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}
