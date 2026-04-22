import { SlideShell } from "../components/slide-shell";

/**
 * Slide 01 — Anchor.
 *
 * The JSONL line on the left sets the vocabulary for the whole deck: your
 * engineers already leave structured evidence behind, we just read it.
 * The finder-window on the right is the thing they'd recognise on their
 * own machine — `~/.claude/projects` with real-looking session files,
 * one stamped moments ago.
 */
export function Slide01Anchor({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="01 / OPEN" pageNumber={1} totalPages={totalPages}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.1fr 1fr",
          gap: 96,
          alignItems: "center",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 20,
              color: "var(--ink-faint)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 40,
            }}
          >
            one line of evidence
          </div>
          <h2
            className="title mono"
            style={{
              fontSize: 64,
              lineHeight: 1.25,
              letterSpacing: "-0.02em",
              color: "var(--ink)",
              maxWidth: 1100,
              wordBreak: "break-word",
            }}
          >
            <span style={{ color: "var(--ink-muted)" }}>{'{'}</span>
            <span>"type":</span>
            <span style={{ color: "var(--accent)" }}>"assistant"</span>
            <span>, "model":</span>
            <span style={{ color: "var(--accent)" }}>"claude-opus-4-7"</span>
            <span>, "input_tokens":</span>
            <span style={{ color: "var(--warm)" }}>18204</span>
            <span style={{ color: "var(--ink-muted)" }}>{'}'}</span>
          </h2>
          <div
            style={{
              marginTop: 48,
              fontFamily: "var(--f-mono)",
              fontSize: 22,
              color: "var(--ink-muted)",
              letterSpacing: "0.02em",
            }}
          >
            every assistant turn leaves one of these on disk.
          </div>
        </div>

        <Finder />
      </div>
    </SlideShell>
  );
}

function Finder() {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        background: "var(--bg-elev)",
        fontFamily: "var(--f-mono)",
        overflow: "hidden",
      }}
    >
      {/* Traffic-light chrome */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "rgba(237, 232, 222, 0.14)",
          }}
        />
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "rgba(237, 232, 222, 0.14)",
          }}
        />
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "rgba(237, 232, 222, 0.14)",
          }}
        />
        <span
          style={{
            marginLeft: 18,
            fontFamily: "var(--f-mono)",
            fontSize: 16,
            color: "var(--ink-faint)",
            letterSpacing: "0.04em",
          }}
        >
          ~/.claude/projects
        </span>
      </div>

      {/* Column header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          padding: "14px 24px",
          borderBottom: "1px solid var(--border)",
          fontSize: 14,
          color: "var(--ink-faint)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        <span>name</span>
        <span>modified</span>
      </div>

      {/* Rows */}
      {FILES.map((f) => (
        <div
          key={f.name}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            alignItems: "center",
            padding: "18px 24px",
            borderBottom: "1px dashed var(--border)",
            fontSize: 20,
            color: "var(--ink)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                background: f.live ? "var(--accent)" : "var(--ink-faint)",
                borderRadius: f.live ? "50%" : 0,
              }}
            />
            <span>{f.name}</span>
          </span>
          <span
            style={{
              color: f.live ? "var(--accent)" : "var(--ink-muted)",
              fontSize: 18,
              letterSpacing: "0.02em",
            }}
          >
            {f.mtime}
          </span>
        </div>
      ))}

      <div
        style={{
          padding: "14px 24px",
          fontSize: 14,
          color: "var(--ink-faint)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        4 files · jsonl
      </div>
    </div>
  );
}

const FILES: { name: string; mtime: string; live?: boolean }[] = [
  { name: "2c7f9a3b-session.jsonl", mtime: "00:04 ago", live: true },
  { name: "8e412d09-session.jsonl", mtime: "12 min ago" },
  { name: "b3a0617c-session.jsonl", mtime: "47 min ago" },
  { name: "51d8f2ae-session.jsonl", mtime: "yesterday" },
];
