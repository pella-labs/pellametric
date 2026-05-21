import { SlideShell } from "../../deck/components/slide-shell";

const PILLARS = [
  { num: "01", title: "GitHub-native", body: "No new accounts." },
  { num: "02", title: "Privacy-first", body: "Per-user encryption." },
  { num: "03", title: "Open-source", body: "Inspectable. Forkable." },
];

const STEPS = [
  {
    num: "01",
    icon: "github",
    head: "Install the app",
    body: "Manager picks the org. ~30 seconds.",
  },
  {
    num: "02",
    icon: "terminal",
    head: "Run one command",
    body: "Reads local session logs. Nothing to learn.",
  },
  {
    num: "03",
    icon: "dashboard",
    head: "Dashboard lights up",
    body: "Per-dev, per-PR, per-skill. Live in minutes.",
  },
];

export function Slide06Solution({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell
      sectionLabel="05 / THE SOLUTION"
      totalPages={totalPages}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 36, flex: 1 }}>
        <h2 className="title" style={{ maxWidth: 1700, fontSize: 60 }}>
          The <em className="accent">lens</em> for your team's AI workflow.
        </h2>

        {/* Pillars */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 24,
          }}
        >
          {PILLARS.map((p) => (
            <div
              key={p.num}
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                padding: "28px 32px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 16,
                  color: "var(--ink-faint)",
                  letterSpacing: "0.16em",
                }}
              >
                {p.num}
              </span>
              <span
                style={{
                  fontFamily: "var(--f-head)",
                  fontSize: 40,
                  color: "var(--ink)",
                  letterSpacing: "-0.02em",
                  fontWeight: 500,
                  lineHeight: 1,
                }}
              >
                {p.title}
              </span>
              <span
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 18,
                  color: "var(--ink-muted)",
                  lineHeight: 1.4,
                }}
              >
                {p.body}
              </span>
            </div>
          ))}
        </div>

        {/* Flowchart */}
        <div
          style={{
            marginTop: "auto",
            display: "grid",
            gridTemplateColumns: "1fr 60px 1fr 60px 1fr",
            alignItems: "stretch",
            gap: 0,
          }}
        >
          <Step step={STEPS[0]} />
          <Arrow />
          <Step step={STEPS[1]} />
          <Arrow />
          <Step step={STEPS[2]} />
        </div>
      </div>
    </SlideShell>
  );
}

function Step({ step }: { step: typeof STEPS[number] }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        background: "var(--bg-elev)",
        padding: "24px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: "var(--f-sys)",
            fontSize: 40,
            color: "var(--accent)",
            letterSpacing: "-0.025em",
            lineHeight: 1,
          }}
        >
          {step.num}
        </span>
        <StepIcon kind={step.icon} />
      </div>
      <div
        style={{
          fontFamily: "var(--f-head)",
          fontSize: 26,
          color: "var(--ink)",
          letterSpacing: "-0.015em",
          fontWeight: 500,
          lineHeight: 1.15,
        }}
      >
        {step.head}
      </div>
      <div
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 17,
          color: "var(--ink-muted)",
          lineHeight: 1.4,
        }}
      >
        {step.body}
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--accent)",
        fontSize: 36,
        fontFamily: "var(--f-mono)",
      }}
      aria-hidden
    >
      →
    </div>
  );
}

function StepIcon({ kind }: { kind: string }) {
  const props = {
    width: 36,
    height: 36,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style: { color: "var(--ink-muted)" },
    "aria-hidden": true,
  };
  if (kind === "github") {
    return (
      <svg {...props} fill="var(--ink-muted)" stroke="none">
        <title>GitHub</title>
        <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.57.1.78-.25.78-.55 0-.27-.01-1-.02-1.96-3.2.7-3.87-1.54-3.87-1.54-.53-1.34-1.29-1.69-1.29-1.69-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.26 3.39.97.1-.75.4-1.27.74-1.56-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.3-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11.02 11.02 0 0 1 5.79 0c2.2-1.5 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.06.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.41-5.27 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.79.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
      </svg>
    );
  }
  if (kind === "terminal") {
    return (
      <svg {...props}>
        <title>Terminal</title>
        <rect x="3" y="4" width="18" height="16" rx="1" />
        <path d="M7 9l3 3-3 3" />
        <path d="M13 15h4" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <title>Dashboard</title>
      <rect x="3" y="4" width="18" height="16" rx="1" />
      <path d="M3 10h18" />
      <path d="M9 4v16" />
    </svg>
  );
}
