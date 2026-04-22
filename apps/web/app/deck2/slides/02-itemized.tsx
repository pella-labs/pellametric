import { Fragment } from "react";
import { SlideShell } from "../components/slide-shell";

/**
 * Slide 02 — Itemized.
 *
 * Four nouns are all we need to describe a coding session in flight. The
 * invoice panel on the right grounds that in the shape of a document
 * readers already know — a bill — and the last row stays redacted to set
 * up the "nobody else even has a label for zombie sessions" punchline.
 */
export function Slide02Itemized({ totalPages }: { totalPages: number }) {
  return (
    <SlideShell sectionLabel="02 / THE PROBLEM" pageNumber={2} totalPages={totalPages}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.2fr 1fr",
          gap: 96,
          alignItems: "start",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div>
          <h2 className="title">
            Project. Developer. Session. <em>Active or zombie.</em>
          </h2>

          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "72px 0 0",
              fontFamily: "var(--f-mono)",
              fontSize: 32,
              color: "var(--ink)",
              letterSpacing: "-0.01em",
            }}
          >
            {NOUNS.map((n) => (
              <li
                key={n.label}
                style={{
                  display: "grid",
                  gridTemplateColumns: "48px 1fr auto",
                  alignItems: "baseline",
                  padding: "20px 0",
                  borderBottom: "1px solid var(--border)",
                  columnGap: 24,
                }}
              >
                <span
                  style={{
                    color: "var(--ink-faint)",
                    fontSize: 18,
                    letterSpacing: "0.08em",
                  }}
                >
                  {n.index}
                </span>
                <span>{n.label}</span>
                <span
                  style={{
                    color: "var(--ink-muted)",
                    fontSize: 18,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  {n.meta}
                </span>
              </li>
            ))}
          </ul>

          <div
            style={{
              marginTop: 48,
              fontFamily: "var(--f-mono)",
              fontSize: 20,
              color: "var(--ink-faint)",
              letterSpacing: "0.02em",
              lineHeight: 1.5,
            }}
          >
            14 fields per line · 13 aggregated series · 1 that nobody else labels.
          </div>
        </div>

        <Invoice />
      </div>
    </SlideShell>
  );
}

const NOUNS: { index: string; label: string; meta: string }[] = [
  { index: "01", label: "project", meta: "repo + branch" },
  { index: "02", label: "developer", meta: "email" },
  { index: "03", label: "session", meta: "uuid" },
  { index: "04", label: "active / zombie", meta: "ours" },
];

function Invoice() {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        background: "var(--bg-elev)",
        padding: 40,
        fontFamily: "var(--f-mono)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 16,
          color: "var(--ink-faint)",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          marginBottom: 10,
        }}
      >
        <span>session — 2c7f9a3b</span>
        <span>apr 22 · 09:41</span>
      </div>
      <div
        style={{
          fontSize: 22,
          color: "var(--ink)",
          marginBottom: 28,
          letterSpacing: "-0.01em",
        }}
      >
        Itemized signals
      </div>

      <div
        style={{
          borderTop: "1px solid var(--border)",
          paddingTop: 24,
          display: "grid",
          gridTemplateColumns: "1fr auto",
          columnGap: 40,
          rowGap: 18,
          fontSize: 20,
          alignItems: "center",
        }}
      >
        {ROWS.map((r) =>
          r.redacted ? (
            <Fragment key={r.label}>
              <span style={{ color: "var(--accent)" }}>{r.label}</span>
              <span
                aria-hidden
                className="deck-redact-bar"
                style={{
                  justifySelf: "end",
                  width: "64%",
                  minWidth: 160,
                  height: 24,
                  background: "var(--accent)",
                  opacity: 0.32,
                  animationDelay: "0.6s",
                }}
              />
            </Fragment>
          ) : (
            <Fragment key={r.label}>
              <span style={{ color: "var(--ink-muted)" }}>{r.label}</span>
              <span style={{ color: "var(--ink)", letterSpacing: "0.02em" }}>{r.value}</span>
            </Fragment>
          ),
        )}
      </div>

      <div
        style={{
          marginTop: 28,
          paddingTop: 20,
          borderTop: "1px dashed var(--border)",
          display: "flex",
          justifyContent: "space-between",
          fontSize: 14,
          color: "var(--ink-faint)",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
        }}
      >
        <span>14 fields per line</span>
        <span>jsonl · local</span>
      </div>
    </div>
  );
}

const ROWS: { label: string; value?: string; redacted?: boolean }[] = [
  { label: "project", value: "pella-labs/pellametric" },
  { label: "developer", value: "walid@pella.com" },
  { label: "tokens_in", value: "18,204" },
  { label: "tokens_out", value: "2,981" },
  { label: "zombie sessions", redacted: true },
];
