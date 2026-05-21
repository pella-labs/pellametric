import { SlideShell } from "../../deck/components/slide-shell";

const SECURITY_STATUS = [
  {
    label: "Today",
    items: ["Per-user encryption", "Self-host arch", "OAuth-only auth"],
    tone: "accent",
  },
  {
    label: "90 days",
    items: ["Trust page", "Audit event log", "Tenant tests"],
    tone: "ink",
  },
  {
    label: "When triggered",
    items: ["Vanta + auditor", "Pentest", "SOC 2 Type I → II"],
    tone: "warm",
  },
];

const TONE: Record<string, string> = {
  accent: "var(--accent)",
  warm: "var(--warm)",
  ink: "var(--ink-faint)",
};

export function Slide10Privacy({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell
      sectionLabel="08 / PRIVACY & SECURITY"
      totalPages={totalPages}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 28, flex: 1 }}>
        <h2 className="title" style={{ maxWidth: 1680 }}>
          Privacy by <em className="accent">architecture</em>. SOC 2 on schedule.
        </h2>

        {/* Architecture diagram */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 60px 1fr 60px 1fr",
            alignItems: "stretch",
            gap: 0,
            flex: 1,
            minHeight: 0,
          }}
        >
          <ArchNode
            label="Engineer's machine"
            sublabel="Local · Trusted"
            items={[
              "Session logs",
              "Raw prompts",
              "Source code",
              "PR metadata",
            ]}
            tone="ink"
          />
          <Boundary label="Encrypt at edge" />
          <ArchNode
            label="Wire"
            sublabel="Metadata only · TLS"
            items={[
              "Token counts",
              "Encrypted prompts (opt-in)",
              "PR / skill / model",
              "No source code",
            ]}
            tone="accent"
            emphasis
          />
          <Boundary label="Per-user DEK" />
          <ArchNode
            label="Our servers"
            sublabel="Opaque blobs · No keys"
            items={[
              "Aggregates",
              "Manager dashboards",
              "No prompt text readable",
              "No code readable",
            ]}
            tone="ink"
          />
        </div>

        {/* Compliance status row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
          }}
        >
          {SECURITY_STATUS.map((s) => (
            <div
              key={s.label}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 13,
                  color: TONE[s.tone],
                  textTransform: "uppercase",
                  letterSpacing: "0.18em",
                }}
              >
                {s.label}
              </span>
              <span
                style={{
                  fontFamily: "var(--f-mono)",
                  fontSize: 17,
                  color: "var(--ink-muted)",
                  lineHeight: 1.4,
                }}
              >
                {s.items.join(" · ")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </SlideShell>
  );
}

function ArchNode({
  label,
  sublabel,
  items,
  tone,
  emphasis,
}: {
  label: string;
  sublabel: string;
  items: string[];
  tone: "ink" | "accent";
  emphasis?: boolean;
}) {
  const accent = tone === "accent" ? "var(--accent)" : "var(--ink-faint)";
  return (
    <div
      style={{
        border: emphasis
          ? "1px solid var(--accent)"
          : "1px solid var(--border)",
        background: emphasis
          ? "rgba(110, 138, 111, 0.06)"
          : "var(--bg-elev)",
        padding: "24px 26px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 13,
            color: accent,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
          }}
        >
          {sublabel}
        </span>
        <span
          style={{
            fontFamily: "var(--f-head)",
            fontSize: 28,
            color: "var(--ink)",
            letterSpacing: "-0.02em",
            fontWeight: 500,
            lineHeight: 1.1,
          }}
        >
          {label}
        </span>
      </div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {items.map((it) => (
          <li
            key={it}
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 16,
              color: "var(--ink-muted)",
              lineHeight: 1.4,
              paddingLeft: 18,
              position: "relative",
            }}
          >
            <span
              aria-hidden
              style={{ position: "absolute", left: 0, color: accent }}
            >
              ·
            </span>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Boundary({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
      aria-hidden
    >
      <div
        style={{
          color: "var(--accent)",
          fontSize: 36,
          fontFamily: "var(--f-mono)",
          lineHeight: 1,
        }}
      >
        →
      </div>
      <div
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 11,
          color: "var(--ink-faint)",
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          textAlign: "center",
          maxWidth: 60,
          lineHeight: 1.3,
        }}
      >
        {label}
      </div>
    </div>
  );
}
