import { SlideShell } from "../../deck/components/slide-shell";

export function Slide08ManagerDashboard({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="06 / MANAGER DASHBOARD" totalPages={totalPages}>
      <div style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1 }}>
        <h2 className="title" style={{ maxWidth: 1620 }}>
          Stop guessing at <em className="accent">engineering ROI</em>.
        </h2>

        {/* Dashboard screenshot — hero, fills the rest of the slide */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            position: "relative",
            border: "1px solid var(--border)",
            background: "var(--bg-elev)",
            overflow: "hidden",
            boxShadow: "0 40px 80px -30px rgba(0,0,0,0.7)",
          }}
        >
          <img
            src="/dash-team.png"
            alt="Pellametric team dashboard"
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "top left",
            }}
          />

          {/* Insight callout — overlaid on the screenshot */}
          <div
            style={{
              position: "absolute",
              bottom: 32,
              right: 32,
              maxWidth: 600,
              border: "1px solid var(--accent)",
              background: "rgba(10, 11, 13, 0.92)",
              backdropFilter: "blur(8px)",
              padding: "20px 28px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              className="sys"
              style={{ color: "var(--accent)", fontSize: 14 }}
            >
              Insight
            </div>
            <div
              style={{
                fontFamily: "var(--f-head)",
                fontSize: 24,
                color: "var(--ink)",
                lineHeight: 1.3,
                fontWeight: 500,
                letterSpacing: "-0.015em",
              }}
            >
              "Ariel ships team average — on{" "}
              <span className="accent">half the tokens</span>."
            </div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}
