import { SlideShell } from "../components/slide-shell";

/**
 * Slide 03 — What we built.
 *
 * Left column: three evidence chips, each with a file-path citation —
 * the audience can (and should) verify these are real. Right column: a
 * 3×3 rack of behavioural-signal tiles, each one is a field the JSONL
 * already gives us. Hairlines only, no fills, no decoration.
 */
export function Slide03WhatWeBuilt({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="03 / WHAT WE BUILT" pageNumber={3} totalPages={totalPages}>
      <div style={{ maxWidth: 1500 }}>
        <h2 className="title">
          Reads the files your engineers <em>already leave behind.</em>
        </h2>
        <div
          style={{
            marginTop: 28,
            fontFamily: "var(--f-mono)",
            fontSize: 22,
            color: "var(--ink-muted)",
            letterSpacing: "0.02em",
          }}
        >
          14 fields · 3 sources · 1 local process · 0 cloud forwarding of prompt bodies.
        </div>
      </div>

      <div
        style={{
          marginTop: 72,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 72,
          alignItems: "start",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {CHIPS.map((c, i) => (
            <Chip key={c.title} index={i + 1} {...c} />
          ))}
        </div>

        <div>
          <div
            style={{
              fontFamily: "var(--f-mono)",
              fontSize: 16,
              color: "var(--ink-faint)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 18,
            }}
          >
            behavioural signals · live
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 0,
              borderTop: "1px solid var(--border)",
              borderLeft: "1px solid var(--border)",
            }}
          >
            {TILES.map((t) => (
              <div
                key={t.label}
                style={{
                  padding: "22px 20px",
                  borderRight: "1px solid var(--border)",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  minHeight: 120,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--f-mono)",
                    fontSize: 14,
                    color: "var(--ink-faint)",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  {t.label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--f-sys)",
                    fontSize: 36,
                    color: "var(--ink)",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {t.value}
                </span>
                <span
                  style={{
                    fontFamily: "var(--f-mono)",
                    fontSize: 14,
                    color: t.tone === "warm" ? "var(--warm)" : "var(--accent)",
                    letterSpacing: "0.02em",
                  }}
                >
                  {t.unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SlideShell>
  );
}

function Chip({
  index,
  title,
  body,
  refs,
}: {
  index: number;
  title: string;
  body: string;
  refs: string[];
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        padding: "24px 28px",
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        columnGap: 24,
        alignItems: "start",
        background: "var(--bg-elev)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--f-mono)",
          fontSize: 18,
          color: "var(--ink-faint)",
          letterSpacing: "0.08em",
          paddingTop: 4,
        }}
      >
        0{index}
      </span>
      <div>
        <div
          style={{
            fontFamily: "var(--f-head)",
            fontSize: 28,
            color: "var(--ink)",
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
            marginBottom: 8,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: "var(--f-sans)",
            fontSize: 18,
            color: "var(--ink-muted)",
            lineHeight: 1.4,
            marginBottom: 14,
          }}
        >
          {body}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {refs.map((r) => (
            <code
              key={r}
              style={{
                fontFamily: "var(--f-mono)",
                fontSize: 14,
                color: "var(--accent)",
                letterSpacing: "0.02em",
              }}
            >
              {r}
            </code>
          ))}
        </div>
      </div>
    </div>
  );
}

const CHIPS: { title: string; body: string; refs: string[] }[] = [
  {
    title: "Local-first collector",
    body: "10s poll, bearer-auth ingest to your own host.",
    refs: ["apps/collector/src/config.ts:7", "apps/web/app/api/ingest/route.ts:66"],
  },
  {
    title: "AES-256-GCM per-user DEK",
    body: "Wrapped with a master key, enforced at query — not at render.",
    refs: ["apps/web/lib/crypto/prompts.ts:5-68", "apps/web/app/api/prompts/route.ts:29-44"],
  },
  {
    title: "Claude Code + Codex today",
    body: "Cursor in review.",
    refs: ["feat/cursor-adapter"],
  },
];

const TILES: { label: string; value: string; unit: string; tone?: "warm" }[] = [
  { label: "teacher moments", value: "42", unit: "+ this week" },
  { label: "frustration spikes", value: "7", unit: "flagged", tone: "warm" },
  { label: "prompt p50", value: "3.2k", unit: "tokens" },
  { label: "prompt p95", value: "18.4k", unit: "tokens" },
  { label: "waste %", value: "11.4", unit: "retries", tone: "warm" },
  { label: "thrash files", value: "6", unit: "hot spots" },
  { label: "context switches", value: "24", unit: "per day" },
  { label: "stuck sessions", value: "3", unit: "> 30 min", tone: "warm" },
  { label: "zombie sessions", value: "2", unit: "idle > 2h", tone: "warm" },
];
