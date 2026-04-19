import { SlideShell } from "../components/slide-shell";

export function Slide03FlyingBlind({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="02 / THE PROBLEM" pageNumber={3} totalPages={totalPages}>
      <div className="eyebrow">02 / THE PROBLEM</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.1fr 1fr",
          gap: 96,
          alignItems: "start",
          flex: 1,
        }}
      >
        <div>
          <h2 className="title">
            The problem: <em>flying blind</em>.
          </h2>
          <p className="body-text" style={{ marginTop: 48 }}>
            Every prompt, every tool call, every speed-up — locked in real time on each developer's
            machine.
          </p>
          <ul className="reader-list" style={{ marginTop: 48 }}>
            <li>The data exists but remains owned and scattered</li>
            <li>It is not aggregated across teams or systems</li>
            <li>It is not used — not to coach, not to learn</li>
          </ul>
        </div>
        <div style={{ position: "relative", height: 640 }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              border: "1px solid var(--border)",
              background: "var(--bg-elev)",
              padding: 32,
              overflow: "hidden",
            }}
          >
            <div className="sys" style={{ marginBottom: 16 }}>
              ~/bin/history
            </div>
            <div
              className="terminal"
              style={{
                marginTop: 0,
                padding: 0,
                border: "none",
                background: "transparent",
                fontSize: 20,
                lineHeight: 2,
                color: "var(--ink-faint)",
              }}
            >
              <div>
                <span className="term-prompt">$</span>
                <span style={{ color: "var(--ink-muted)" }}>
                  claude -p "refactor auth middleware"
                </span>
              </div>
              <div>
                <span style={{ color: "var(--ink-faint)" }}>
                  tokens: 48,231 · cost: $0.82 · merged: ?
                </span>
              </div>
              <div>
                <span className="term-prompt">$</span>
                <span style={{ color: "var(--ink-muted)" }}>
                  cursor generate "add webhook retry"
                </span>
              </div>
              <div>
                <span style={{ color: "var(--ink-faint)" }}>
                  accepted: 7/12 · cost: $0.23 · merged: ?
                </span>
              </div>
              <div>
                <span className="term-prompt">$</span>
                <span style={{ color: "var(--ink-muted)" }}>codex exec "fix flaky test"</span>
              </div>
              <div>
                <span style={{ color: "var(--ink-faint)" }}>
                  tokens: 12,104 · cost: $0.19 · merged: ?
                </span>
              </div>
              <div>
                <span className="term-prompt">$</span>
                <span style={{ color: "var(--ink-muted)" }}>continue → chat, 14 turns</span>
              </div>
              <div>
                <span style={{ color: "var(--ink-faint)" }}>cost: $1.04 · outcome: ?</span>
              </div>
              <div style={{ marginTop: 20, color: "var(--warm)", fontSize: 16 }}>
                {"// stays on this laptop · never aggregated"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </SlideShell>
  );
}
