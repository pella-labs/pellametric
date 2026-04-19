import { BSymbol, SlideShell } from "../components/slide-shell";

export function Slide07Platform({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="05 / PLATFORM" pageNumber={7} totalPages={totalPages}>
      <div className="eyebrow">05 / PLATFORM</div>
      <h2 className="title">One open-source platform.</h2>
      <p className="lede" style={{ marginTop: 24, fontSize: 36 }}>
        Auto-instruments every developer's coding-agent usage. Correlates LLM spend with Git
        outcomes.{" "}
        <em style={{ fontStyle: "normal", color: "var(--accent)" }}>Measured, accountable,</em> one
        view of your AI investment.
      </p>

      <div className="diagram">
        <div className="diagram-nodes">
          <div className="sys" style={{ marginBottom: 8 }}>
            Sources
          </div>
          {["Claude Code", "Cursor", "Codex CLI", "Continue.dev", "OpenCode", "VS Code"].map(
            (name) => (
              <div key={name} className="diagram-node">
                <span>{name}</span>
                <span className="dot" />
              </div>
            ),
          )}
        </div>

        <div className="diagram-center">
          <svg
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
            viewBox="0 0 400 500"
            preserveAspectRatio="none"
            aria-hidden
            role="presentation"
          >
            <title>Platform diagram connectors</title>
            <g stroke="rgba(237,232,222,0.18)" strokeWidth="1" fill="none">
              <path d="M 0 40 Q 200 250 200 250" />
              <path d="M 0 130 Q 200 250 200 250" />
              <path d="M 0 220 Q 200 250 200 250" />
              <path d="M 0 280 Q 200 250 200 250" />
              <path d="M 0 370 Q 200 250 200 250" />
              <path d="M 0 460 Q 200 250 200 250" />
              <path d="M 200 250 Q 300 250 400 100" />
              <path d="M 200 250 Q 300 250 400 220" />
              <path d="M 200 250 Q 300 250 400 340" />
              <path d="M 200 250 Q 300 250 400 460" />
            </g>
          </svg>
          <div className="diagram-hub">
            <BSymbol />
          </div>
        </div>

        <div className="diagram-nodes">
          <div className="sys" style={{ marginBottom: 8 }}>
            Surfaces
          </div>
          {["Cost visibility", "Outcome tracking", "Efficiency signals", "Team leaderboards"].map(
            (name) => (
              <div key={name} className="diagram-node">
                <span className="dot" />
                <span>{name}</span>
              </div>
            ),
          )}
        </div>
      </div>
    </SlideShell>
  );
}
