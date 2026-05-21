import { SlideShell } from "../../deck/components/slide-shell";

type Member = {
  name: string;
  role: string;
  photo: string;
};

const TEAM: Member[] = [
  { name: "Alex", role: "Growth & ops", photo: "/team/jorge.jpeg" },
  { name: "David", role: "Security", photo: "/team/david.jpeg" },
  { name: "Sandesh", role: "Infrastructure", photo: "/team/sandesh.jpeg" },
  { name: "Sebastian", role: "Insights", photo: "/team/sebastian.jpeg" },
  { name: "Walid", role: "Product", photo: "/team/walid.jpeg" },
];

export function Slide12Team({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="10 / THE TEAM" totalPages={totalPages}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          justifyContent: "center",
          gap: 80,
        }}
      >
        <h2 className="title" style={{ maxWidth: 1680, fontSize: 76 }}>
          Five engineers. One bootcamp.{" "}
          <em className="accent">First customer in 8 weeks.</em>
        </h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 48,
            width: "100%",
            maxWidth: 1680,
          }}
        >
          {TEAM.map((m) => (
            <div
              key={m.name}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 20,
              }}
            >
              <div className="deck-team-portrait" aria-hidden>
                <div className="deck-team-portrait-inner">
                  <img src={m.photo} alt={m.name} />
                </div>
              </div>
              <div
                style={{
                  fontFamily: "var(--f-head)",
                  fontSize: 36,
                  fontWeight: 500,
                  letterSpacing: "-0.02em",
                  color: "var(--ink)",
                  lineHeight: 1,
                }}
              >
                {m.name}
              </div>
              <div
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 17,
                  color: "var(--accent)",
                  textTransform: "uppercase",
                  letterSpacing: "0.14em",
                }}
              >
                {m.role}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SlideShell>
  );
}
