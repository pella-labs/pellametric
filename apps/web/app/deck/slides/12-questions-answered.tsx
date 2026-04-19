import { SlideShell } from "../components/slide-shell";

export function Slide12QuestionsAnswered({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="09 / ANSWERS" pageNumber={12} totalPages={totalPages}>
      <div className="eyebrow">09 / THREE QUESTIONS · ANSWERED</div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 64,
          flex: 1,
          marginTop: 32,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 48,
          }}
        >
          {[
            {
              kicker: "01 · Spend",
              body: "Costs broken down by repositories, models, and work type.",
            },
            {
              kicker: "02 · Value",
              body: "Identify sessions that shipped code. Isolate generated cost without outcome.",
            },
            {
              kicker: "03 · Efficiency",
              body: "Understand why engineers achieve the same task with widely varying token consumption.",
            },
          ].map((a) => (
            <div key={a.kicker}>
              <div className="sys" style={{ color: "var(--accent)" }}>
                {a.kicker}
              </div>
              <div
                style={{
                  fontFamily: "var(--f-head)",
                  fontSize: 44,
                  lineHeight: 1.1,
                  letterSpacing: "-0.02em",
                  marginTop: 16,
                  color: "var(--ink)",
                }}
              >
                {a.body}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            border: "1px solid var(--border)",
            background: "var(--bg-elev)",
            padding: "56px 48px",
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div className="sys">{"// From the bematist CLI"}</div>
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 22,
              lineHeight: 1.8,
              color: "var(--ink-muted)",
            }}
          >
            <div>
              <span className="accent">$</span>{" "}
              <span className="ink">bematist summary --last 30d</span>
            </div>
            <div style={{ color: "var(--ink-faint)" }}>────────────────────────────────</div>
            <div>
              <span className="muted">spend.............</span> <span className="ink">$28,412</span>
            </div>
            <div>
              <span className="muted">accepted_edits....</span> <span className="ink">14,302</span>
            </div>
            <div>
              <span className="muted">merged_prs........</span> <span className="ink">1,086</span>
            </div>
            <div>
              <span className="muted">$/merged_pr.......</span>{" "}
              <span className="accent">$26.15</span>
            </div>
            <div>
              <span className="muted">outliers..........</span>{" "}
              <span className="warm">37 sessions</span>
            </div>
            <div style={{ marginTop: 20 }}>
              <span className="accent">$</span>{" "}
              <span className="ink">bematist outcomes --by repo</span>
            </div>
            <div style={{ color: "var(--ink-faint)" }}>────────────────────────────────</div>
            <div>
              <span className="muted">api-gateway.......</span>{" "}
              <span className="ink">$12.08 / PR</span>
            </div>
            <div>
              <span className="muted">web-app...........</span>{" "}
              <span className="ink">$31.44 / PR</span>
            </div>
            <div>
              <span className="muted">billing...........</span>{" "}
              <span className="warm">$68.12 / PR</span>
            </div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}
