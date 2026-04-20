/**
 * Stubbed team dashboard mockup. Designed illustration rather than a real
 * screenshot until the team dashboard ships production data. The rectangles
 * are intentionally stylized so the visitor reads it as "here is the shape
 * of the product" not "here is a production screenshot".
 */
const KPIS = [
  { label: "Weekly spend", value: "$4,218" },
  { label: "Accepted edits", value: "12,480" },
  { label: "Merged PRs w/ AI", value: "186" },
  { label: "Per-dollar edits", value: "14.2x" },
] as const;

const NAV = ["Summary", "Teams", "Sessions", "Outcomes", "Clusters", "Insights"] as const;

export function DashboardShot() {
  const bars = [42, 48, 61, 55, 72, 78, 82, 74, 88, 95, 82, 90, 76, 86];
  return (
    <section className="mk-dashboard-shot">
      <div style={{ textAlign: "center", maxWidth: 640 }}>
        <span className="mk-sys" style={{ display: "block", marginBottom: 12 }}>
          The instrument
        </span>
        <h2
          className="mk-mono"
          style={{
            fontSize: "clamp(24px, 3vw, 36px)",
            letterSpacing: "-0.02em",
          }}
        >
          One surface for the whole stack.
        </h2>
        <p
          style={{
            color: "var(--mk-ink-muted)",
            fontSize: 15,
            marginTop: 12,
            lineHeight: 1.55,
          }}
        >
          What your agents cost, what they shipped, and which prompts actually ship code. Built for
          engineering leaders handed an AI bill, a pile of session logs, and asked to make sense of
          both.
        </p>
      </div>

      <div className="mk-dashboard-shot-frame" aria-hidden>
        <div className="mk-dashboard-shot-chrome">
          <span style={{ background: "#ff5f57" }} />
          <span style={{ background: "#febc2e" }} />
          <span style={{ background: "#28c840" }} />
          <span className="dot-url">bematist.yourteam.internal / summary</span>
        </div>
        <div className="mk-dashboard-shot-body">
          <div className="mk-dashboard-shot-side">
            {NAV.map((item, i) => (
              <div key={item} className={`mk-dashboard-shot-side-item ${i === 0 ? "active" : ""}`}>
                {item}
              </div>
            ))}
          </div>
          <div className="mk-dashboard-shot-main">
            <div className="mk-dashboard-shot-kpis">
              {KPIS.map((k) => (
                <div key={k.label} className="mk-dashboard-shot-kpi">
                  <div className="mk-dashboard-shot-kpi-label">{k.label}</div>
                  <div className="mk-dashboard-shot-kpi-value">{k.value}</div>
                </div>
              ))}
            </div>
            <div className="mk-dashboard-shot-chart">
              {bars.map((h, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: static mockup
                  key={i}
                  className="mk-dashboard-shot-chart-bar"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
