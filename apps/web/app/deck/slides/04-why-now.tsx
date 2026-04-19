import { SlideShell } from "../components/slide-shell";

export function Slide04WhyNow({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="03 / WHY NOW" pageNumber={4} totalPages={totalPages}>
      <div className="eyebrow">03 / WHY NOW</div>
      <h2 className="title">
        The moment has <em>arrived</em>.
      </h2>

      <div className="timeline">
        <div className="timeline-col">
          <div className="timeline-year">$</div>
          <h4>Spend became material</h4>
          <p>AI coding tools are now a top-three line item in most engineering budgets.</p>
        </div>
        <div className="timeline-col">
          <div className="timeline-year">◎</div>
          <h4>Data became available</h4>
          <p>Every major coding agent now writes structured telemetry to disk by default.</p>
        </div>
        <div className="timeline-col">
          <div className="timeline-year">§</div>
          <h4>Regulators arrived</h4>
          <p>EU AI Act, SOC 2 for AI, and customer trust reviews demand intuition-proof supply.</p>
        </div>
      </div>

      <div
        style={{
          marginTop: 48,
          display: "flex",
          alignItems: "stretch",
          gap: 32,
          minHeight: 0,
        }}
      >
        <div className="bars" style={{ flex: 1 }}>
          <div className="bar" style={{ height: "18%" }} data-year="'22" />
          <div className="bar" style={{ height: "26%" }} data-year="'23" />
          <div className="bar" style={{ height: "44%" }} data-year="'24" />
          <div className="bar" style={{ height: "72%" }} data-year="'25" />
          <div className="bar" style={{ height: "96%" }} data-year="'26" />
        </div>
        <div
          style={{
            width: 440,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div className="sys" style={{ marginBottom: 8 }}>
            Avg. AI spend per engineer
          </div>
          <div
            style={{
              fontFamily: "var(--f-sys)",
              fontSize: 64,
              color: "var(--accent)",
              lineHeight: 1,
              letterSpacing: "-0.03em",
            }}
          >
            12×
          </div>
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 18,
              color: "var(--ink-muted)",
              marginTop: 10,
              lineHeight: 1.4,
            }}
          >
            growth in four years — every engineering org will need this.
          </div>
        </div>
      </div>
    </SlideShell>
  );
}
