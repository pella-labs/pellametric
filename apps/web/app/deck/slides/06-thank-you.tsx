"use client";

/**
 * Closing "Thank you." slide — displayed while taking audience Q&A.
 * Five team portraits with a shimmering sage border, name, role, and
 * LinkedIn + X handles.
 *
 * LinkedIn/X handles are placeholders — replace once collected.
 */

type TeamMember = {
  name: string;
  role: string;
  photo: string;
  linkedin: string; // full URL
  linkedinLabel: string; // shortened label shown on slide
  x: string; // full URL
  xHandle: string; // shown on slide (without @)
};

const TEAM: TeamMember[] = [
  {
    name: "Walid Khori",
    role: "Founder",
    photo: "/team/walid.jpeg",
    linkedin: "https://www.linkedin.com/in/walidkhori/",
    linkedinLabel: "in/walidkhori",
    x: "https://x.com/wkhori",
    xHandle: "wkhori",
  },
  {
    name: "David Aihe",
    role: "Engineering",
    photo: "/team/david.jpeg",
    linkedin: "https://www.linkedin.com/in/david-aihe/",
    linkedinLabel: "in/david-aihe",
    x: "https://x.com/divici_a",
    xHandle: "divici_a",
  },
  {
    name: "Sebastian Garces",
    role: "Engineering",
    photo: "/team/sebastian.jpeg",
    linkedin: "https://www.linkedin.com/in/gsebastiangarces/",
    linkedinLabel: "in/gsebastiangarces",
    x: "https://x.com/gsgarces",
    xHandle: "gsgarces",
  },
  {
    name: "Jorge Alejandro Diez",
    role: "Engineering",
    photo: "/team/jorge.jpeg",
    linkedin: "https://www.linkedin.com/in/jalejandrodiez/",
    linkedinLabel: "in/jalejandrodiez",
    x: "https://x.com/jalejandrodiez",
    xHandle: "jalejandrodiez",
  },
  {
    name: "Sandesh Pathak",
    role: "Engineering",
    photo: "/team/sandesh.jpeg",
    linkedin: "https://www.linkedin.com/in/pathaksandesh/",
    linkedinLabel: "in/pathaksandesh",
    x: "https://x.com/pathak_san99836",
    xHandle: "pathak_san99836",
  },
];

export function Slide06ThankYou(_props: { totalPages: number }) {
  return (
    <div
      className="slide"
      style={{
        padding: 0,
        height: "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div className="grid-bg" />

      {/* Ambient wash — same accent glow family used on 05 so the two closers
          feel tonally matched, but softer and more centered for Q&A */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(55% 50% at 50% 35%, rgba(110,138,111,0.12), transparent 60%), radial-gradient(40% 35% at 85% 80%, rgba(176,123,62,0.08), transparent 65%)",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      <div className="chrome-row">
        <div className="wordmark">
          <img
            className="wordmark-dot"
            src="/primary-logo.svg"
            alt="Pellametric"
          />
        </div>
        <div className="chrome-right">05 / THANK YOU</div>
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "192px 96px 96px",
          height: "100%",
          boxSizing: "border-box",
          gap: 64,
        }}
      >
        {/* Headline block */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 24,
            textAlign: "center",
          }}
        >
          <h2
            className="title"
            style={{
              margin: 0,
              fontSize: 140,
              lineHeight: 1,
            }}
          >
            Thank you.{" "}
            <span style={{ color: "var(--accent)", fontWeight: 500 }}>
              Questions?
            </span>
          </h2>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            <CompanyLink
              href="https://github.com/pella-labs/pellametric"
              label="github.com/pella-labs/pellametric"
            >
              <GitHubGlyph />
            </CompanyLink>
            <CompanyLink href="https://x.com/pellametric" label="@pellametric">
              <XGlyph />
            </CompanyLink>
          </div>
        </div>

        {/* Team row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 40,
            width: "100%",
            maxWidth: 1680,
          }}
        >
          {TEAM.map((m) => (
            <TeamCard key={m.name} member={m} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TeamCard({ member }: { member: TeamMember }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
      }}
    >
      <div className="deck-team-portrait" aria-hidden>
        <div className="deck-team-portrait-inner">
          <img src={member.photo} alt={member.name} />
        </div>
      </div>

      <div
        style={{
          fontFamily: "var(--f-head)",
          fontSize: 28,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: "var(--ink)",
          lineHeight: 1.1,
          textAlign: "center",
        }}
      >
        {member.name}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 8,
          width: "100%",
          paddingTop: 8,
        }}
      >
        <HandleLink href={member.linkedin} label={member.linkedinLabel}>
          <LinkedInGlyph />
        </HandleLink>
        <HandleLink href={member.x} label={`@${member.xHandle}`}>
          <XGlyph />
        </HandleLink>
      </div>
    </div>
  );
}

function CompanyLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        fontFamily: "var(--f-mono)",
        fontSize: 16,
        color: "var(--ink-muted)",
        textDecoration: "none",
        padding: "8px 14px",
        border: "1px solid var(--border)",
        background: "rgba(237, 232, 222, 0.02)",
        letterSpacing: "0.02em",
      }}
    >
      {children}
      <span>{label}</span>
    </a>
  );
}

function HandleLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        fontFamily: "var(--f-mono)",
        fontSize: 17,
        color: "var(--ink-muted)",
        textDecoration: "none",
        padding: "6px 10px",
        border: "1px solid var(--border)",
        background: "rgba(237, 232, 222, 0.02)",
        letterSpacing: "0.02em",
        justifyContent: "flex-start",
      }}
    >
      {children}
      <span>{label}</span>
    </a>
  );
}

function LinkedInGlyph() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "1.5em",
        height: "1.5em",
        borderRadius: 4,
        background: "var(--ink)",
        color: "var(--bg)",
        flexShrink: 0,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        role="img"
        style={{ width: "0.88em", height: "0.88em" }}
      >
        <title>LinkedIn</title>
        <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zM7.12 20.45H3.56V9h3.56v11.45zM22.23 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45C23.2 24 24 23.23 24 22.28V1.72C24 .77 23.2 0 22.23 0z" />
      </svg>
    </span>
  );
}

function GitHubGlyph() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "1.5em",
        height: "1.5em",
        borderRadius: 4,
        background: "var(--ink)",
        color: "var(--bg)",
        flexShrink: 0,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        role="img"
        style={{ width: "0.95em", height: "0.95em" }}
      >
        <title>GitHub</title>
        <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.57.1.78-.25.78-.55 0-.27-.01-1-.02-1.96-3.2.7-3.87-1.54-3.87-1.54-.53-1.34-1.29-1.69-1.29-1.69-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.26 3.39.97.1-.75.4-1.27.74-1.56-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.3-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11.02 11.02 0 0 1 5.79 0c2.2-1.5 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.06.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.41-5.27 5.69.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.79.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
      </svg>
    </span>
  );
}

function XGlyph() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "1.5em",
        height: "1.5em",
        borderRadius: 4,
        background: "var(--ink)",
        color: "var(--bg)",
        flexShrink: 0,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        role="img"
        style={{ width: "0.78em", height: "0.78em" }}
      >
        <title>X</title>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    </span>
  );
}
