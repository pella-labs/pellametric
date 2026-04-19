export function Slide13DataWasYours({ totalPages }: { totalPages: number }) {
  return (
    <div className="quote-slide" style={{ position: "relative" }}>
      <div className="grid-bg" />
      <div className="chrome-row">
        <div className="wordmark">
          <span className="wordmark-dot" /> bematist
        </div>
        <div className="chrome-right">10 / CLOSING THESIS</div>
      </div>
      <div style={{ position: "relative", zIndex: 2 }}>
        <div className="sys" style={{ marginBottom: 48 }}>
          {
            "// The most expensive system your engineering org has ever bought may be the one you understand the least."
          }
        </div>
        <div className="quote-text">
          The data was <em>always yours</em>.
          <br />
          We just made it legible.
        </div>
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 48,
          borderTop: "1px solid var(--border)",
          paddingTop: 48,
        }}
      >
        {[
          ["01 · Try it", "Run the open-source platform against your coding agents today."],
          [
            "02 · Build it in",
            "Use the APIs to create custom views and rules for your organization.",
          ],
          ["03 · Hire the team", "Bring the people who built it inside your engineering org."],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="sys" style={{ marginBottom: 16 }}>
              {k}
            </div>
            <div
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 22,
                color: "var(--ink-muted)",
                lineHeight: 1.5,
              }}
            >
              {v}
            </div>
          </div>
        ))}
      </div>

      <div className="pagenum-left">bematist.dev</div>
      <div className="pagenum">
        13 <span className="total">/ {String(totalPages).padStart(2, "0")}</span>
      </div>
    </div>
  );
}
