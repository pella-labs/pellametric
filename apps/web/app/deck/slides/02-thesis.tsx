import { SlideShell } from "../components/slide-shell";

export function Slide02Thesis({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="01 / THESIS" pageNumber={2} totalPages={totalPages}>
      <div className="eyebrow">01 / THESIS</div>
      <h2 className="title">
        Every technology must <em>account for itself</em>.
      </h2>
      <p className="body-text" style={{ marginTop: 48, maxWidth: 1300 }}>
        Every time a new, expensive system enters engineering, we eventually build an instrument to
        measure it. AI is no exception — just the newest line in a long ledger.
      </p>

      <div className="features" style={{ marginTop: "auto" }}>
        <div className="feature">
          <span className="feature-index">1698</span>
          <h3>Steam engines</h3>
          <p>Met the boiler inspector.</p>
        </div>
        <div className="feature">
          <span className="feature-index">1882</span>
          <h3>Electricity</h3>
          <p>Met the meter.</p>
        </div>
        <div className="feature">
          <span className="feature-index">2006</span>
          <h3>Cloud computing</h3>
          <p>Met the FinOps team.</p>
        </div>
      </div>

      <div
        style={{
          marginTop: 32,
          fontFamily: "var(--f-mono)",
          fontSize: 24,
          color: "var(--ink)",
        }}
      >
        <span className="accent">2026 · </span>AI in engineering — is meeting that moment{" "}
        <em
          style={{
            fontStyle: "normal",
            color: "var(--ink)",
            textDecoration: "underline",
            textUnderlineOffset: 6,
            textDecorationColor: "var(--accent)",
          }}
        >
          now
        </em>
        .
      </div>
    </SlideShell>
  );
}
