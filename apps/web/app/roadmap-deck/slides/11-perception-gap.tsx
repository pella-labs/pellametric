import { SlideShell } from "../../deck/components/slide-shell";

export function Slide11PerceptionGap({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell
      sectionLabel="09 / PERCEPTION vs REALITY"
      totalPages={totalPages}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          justifyContent: "space-between",
        }}
      >
        <h2 className="title" style={{ maxWidth: 1700, fontSize: 64 }}>
          Two studies. Same era.{" "}
          <em className="warm">Opposite conclusions.</em>
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 0,
            border: "1px solid var(--border)",
            background: "var(--bg-elev)",
            flex: 1,
            minHeight: 0,
            marginTop: 32,
          }}
        >
          <Stat
            label="GitHub Research · 2024"
            sublabel="Controlled benchmarks"
            value="+55%"
            verdict="Felt faster. Was faster."
            color="var(--accent)"
            border="right"
          />
          <Stat
            label="METR Study · July 2025"
            sublabel="Real-world OSS work"
            value="−19%"
            verdict="Felt 24% faster. Was 19% slower."
            color="var(--warm)"
          />
        </div>

        <div
          style={{
            marginTop: 32,
            fontFamily: "var(--f-head)",
            fontSize: 32,
            color: "var(--ink)",
            lineHeight: 1.25,
            letterSpacing: "-0.015em",
            fontWeight: 500,
            maxWidth: 1500,
          }}
        >
          "Feels productive" vs "is productive" is{" "}
          <span className="accent">the entire wedge</span>.
        </div>
      </div>
    </SlideShell>
  );
}

function Stat({
  label,
  sublabel,
  value,
  verdict,
  color,
  border,
}: {
  label: string;
  sublabel: string;
  value: string;
  verdict: string;
  color: string;
  border?: "right";
}) {
  return (
    <div
      style={{
        padding: "48px 56px",
        borderRight: border === "right" ? "1px solid var(--border)" : "none",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 16,
            color,
            textTransform: "uppercase",
            letterSpacing: "0.18em",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 14,
            color: "var(--ink-faint)",
            letterSpacing: "0.04em",
          }}
        >
          {sublabel}
        </span>
      </div>
      <div
        style={{
          fontFamily: "var(--f-sys)",
          fontSize: 200,
          color,
          letterSpacing: "-0.04em",
          lineHeight: 0.95,
          fontWeight: 700,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: "var(--f-head)",
          fontSize: 28,
          color: "var(--ink)",
          lineHeight: 1.25,
          letterSpacing: "-0.015em",
          fontWeight: 500,
        }}
      >
        {verdict}
      </div>
    </div>
  );
}
