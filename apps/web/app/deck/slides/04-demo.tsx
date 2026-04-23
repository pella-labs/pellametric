import { SlideShell } from "../components/slide-shell";

export function Slide04Demo({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="03 / DEMO" pageNumber={3} totalPages={totalPages}>
      <h2 className="title" style={{ fontSize: 72 }}>
        A single view — outcomes and <em>efficiency</em>.
      </h2>

      <div className="dashmock">
        <div className="dashmock-side">
          <div className="brand">◼ pellametric</div>
          {[
            ["/ Summary", true],
            ["/ Sessions", false],
            ["/ Outcomes", false],
            ["/ Clusters", false],
            ["/ Insights", false],
            ["/ Teams", false],
            ["/ Me", false],
          ].map(([label, active]) => (
            <div
              key={String(label)}
              className={`dashmock-side-item${active ? " active" : ""}`}
            >
              {label}
            </div>
          ))}
        </div>
        <div className="dashmock-main">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div className="sys">Last 30 days · all repos</div>
            <div style={{ display: "flex", gap: 12 }}>
              <span className="badge accent">LIVE</span>
              <span className="badge">CSV</span>
            </div>
          </div>
          <div className="dashmock-kpis">
            <Kpi label="AI spend" value="$28.4K" delta="+18.2% MoM" />
            <Kpi label="Accepted edits" value="14,302" delta="+22.4% MoM" />
            <Kpi label="Merged PRs" value="1,086" delta="+12.8% MoM" />
            <Kpi label="$ / merged PR" value="$26.15" delta="−8.3% MoM" warm />
          </div>
          <div className="dashmock-chart">
            {[34, 48, 42, 62, 54, 70, 58, 76, 68, 82, 74, 88, 80, 94].map(
              (h, i) => (
                <div key={i} className="b" style={{ height: `${h}%` }} />
              ),
            )}
          </div>
        </div>
      </div>
    </SlideShell>
  );
}

function Kpi({
  label,
  value,
  delta,
  warm,
}: {
  label: string;
  value: string;
  delta: string;
  warm?: boolean;
}) {
  return (
    <div className="dashmock-kpi">
      <div className="dashmock-kpi-label">{label}</div>
      <div className="dashmock-kpi-value">{value}</div>
      <div
        className="dashmock-kpi-delta"
        style={warm ? { color: "var(--warm)" } : undefined}
      >
        {delta}
      </div>
    </div>
  );
}
