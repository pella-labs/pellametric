import { SlideShell } from "../../deck/components/slide-shell";

type Milestone = {
  when: string;
  title: string;
  bullets: string[];
  tone: "ink" | "accent" | "warm";
};

const MILESTONES: Milestone[] = [
  {
    when: "Now",
    title: "Foundation",
    bullets: ["Design partner signed", "100+ concurrent students supported"],
    tone: "ink",
  },
  {
    when: "+3 mo",
    title: "Live + viral wedge",
    bullets: [
      "GauntletAI cohort complete",
      "500+ /card shares",
      "5 pilot orgs",
    ],
    tone: "accent",
  },
  {
    when: "+9 mo",
    title: "First revenue",
    bullets: [
      "$10K MRR",
      "8–15 paying teams",
      "Public case study",
    ],
    tone: "accent",
  },
  {
    when: "+18 mo",
    title: "Scale or raise",
    bullets: [
      "$50–100K MRR",
      "or $1.5–3M seed",
      "First enterprise deal → SOC 2",
    ],
    tone: "warm",
  },
];

const TONE: Record<Milestone["tone"], string> = {
  ink: "var(--ink-faint)",
  accent: "var(--accent)",
  warm: "var(--warm)",
};

export function Slide15Roadmap({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="12 / 18-MONTH ROADMAP" totalPages={totalPages}>
      <div style={{ display: "flex", flexDirection: "column", gap: 32, flex: 1 }}>
        <h2 className="title" style={{ maxWidth: 1700, fontSize: 60 }}>
          GauntletAI first.{" "}
          <em className="accent">Everything else is downstream.</em>
        </h2>

        {/* Timeline */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {/* The horizontal track */}
          <div
            style={{
              position: "relative",
              height: 4,
              background:
                "linear-gradient(90deg, var(--ink-faint), var(--accent) 30%, var(--accent) 70%, var(--warm))",
              borderRadius: 2,
              margin: "0 80px",
            }}
          >
            {MILESTONES.map((m, i) => {
              const left = (i / (MILESTONES.length - 1)) * 100;
              return (
                <div
                  key={m.when}
                  style={{
                    position: "absolute",
                    left: `${left}%`,
                    top: "50%",
                    transform: "translate(-50%, -50%)",
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: TONE[m.tone],
                    border: "4px solid var(--bg)",
                    boxShadow: `0 0 0 2px ${TONE[m.tone]}, 0 0 24px ${TONE[m.tone]}`,
                  }}
                />
              );
            })}
          </div>

          {/* Phase columns */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 0,
              marginTop: 56,
              padding: "0 24px",
            }}
          >
            {MILESTONES.map((m) => (
              <div
                key={m.when}
                style={{
                  padding: "0 24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  textAlign: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--f-sys)",
                    fontSize: 32,
                    color: TONE[m.tone],
                    letterSpacing: "-0.025em",
                    lineHeight: 1,
                  }}
                >
                  {m.when}
                </span>
                <span
                  style={{
                    fontFamily: "var(--f-head)",
                    fontSize: 30,
                    color: "var(--ink)",
                    letterSpacing: "-0.02em",
                    fontWeight: 500,
                    lineHeight: 1.15,
                  }}
                >
                  {m.title}
                </span>
                <ul
                  style={{
                    margin: "8px 0 0",
                    padding: 0,
                    listStyle: "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {m.bullets.map((b) => (
                    <li
                      key={b}
                      style={{
                        fontFamily: "var(--f-mono)",
                        fontSize: 17,
                        color: "var(--ink-muted)",
                        lineHeight: 1.4,
                      }}
                    >
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SlideShell>
  );
}
