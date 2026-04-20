import { Fragment } from "react";
import { SlideShell } from "../components/slide-shell";

const LINE_ITEMS: { label: string; width: string }[] = [
  { label: "Developer", width: "62%" },
  { label: "Prompts sent", width: "82%" },
  { label: "Tokens consumed", width: "48%" },
  { label: "Tool calls", width: "74%" },
  { label: "Merged PRs from AI work", width: "58%" },
  { label: "$ per merged PR", width: "88%" },
  { label: "Time saved vs baseline", width: "52%" },
  { label: "Quality of outputs", width: "70%" },
];

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
            The AI bill is a <em>black box</em>.
          </h2>
          <p className="body-text" style={{ marginTop: 48 }}>
            You get the total at the end of the month. Who spent it, on what prompts, toward which
            outcomes — redacted.
          </p>
          <div
            style={{
              marginTop: 40,
              fontFamily: "var(--f-mono)",
              fontSize: 20,
              color: "var(--ink-muted)",
              letterSpacing: "0.04em",
            }}
          >
            Every line item beneath the total is invisible.
          </div>
        </div>

        <div
          style={{
            border: "1px solid var(--border)",
            background: "var(--bg-elev)",
            padding: 40,
            fontFamily: "var(--f-mono)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 16,
              color: "var(--ink-faint)",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              marginBottom: 10,
            }}
          >
            <span>AI Engineering</span>
            <span>October 2026</span>
          </div>
          <div
            style={{
              fontSize: 22,
              color: "var(--ink)",
              marginBottom: 28,
              letterSpacing: "-0.01em",
            }}
          >
            Monthly usage summary
          </div>
          <div
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 24,
              display: "grid",
              gridTemplateColumns: "1fr auto",
              columnGap: 40,
              rowGap: 20,
              fontSize: 20,
              alignItems: "center",
            }}
          >
            {LINE_ITEMS.map(({ label, width }, i) => (
              <Fragment key={label}>
                <span style={{ color: "var(--ink-muted)" }}>{label}</span>
                <span
                  aria-hidden
                  className="deck-redact-bar"
                  style={{
                    justifySelf: "end",
                    width,
                    minWidth: 140,
                    height: 24,
                    animationDelay: `${(i * 0.37).toFixed(2)}s`,
                    animationDuration: `${(3.8 + (i % 3) * 0.5).toFixed(1)}s`,
                  }}
                />
              </Fragment>
            ))}
          </div>
          <div
            style={{
              marginTop: 32,
              paddingTop: 24,
              borderTop: "1px dashed var(--border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <span
              style={{
                color: "var(--ink-muted)",
                fontSize: 18,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
              }}
            >
              Total due
            </span>
            <span
              style={{
                color: "var(--warm)",
                fontFamily: "var(--f-sys)",
                fontSize: 56,
                letterSpacing: "-0.02em",
              }}
            >
              $47,892.00
            </span>
          </div>
          <div
            style={{
              marginTop: 20,
              fontSize: 14,
              color: "var(--ink-faint)",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
            }}
          >
            No per-developer attribution · no outcome linkage
          </div>
        </div>
      </div>
    </SlideShell>
  );
}
