import { ImageResponse } from "next/og";
import { OG_COLORS, OG_CONTENT_TYPE, OG_SIZE, OgFrame, OgHeadline, OgStatRow } from "../_og/chrome";

export const runtime = "nodejs";
export const alt = "Try Bematist — generate your personal coding-agent card";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function CardOg() {
  return new ImageResponse(
    <OgFrame eyebrow="02 / card">
      <OgHeadline
        eyebrow="sys.card // personal card"
        title={
          <span style={{ display: "flex", flexWrap: "wrap" }}>
            See yours,&nbsp;
            <span
              style={{
                color: OG_COLORS.accent,
                fontStyle: "italic",
                display: "flex",
              }}
            >
              then share it.
            </span>
          </span>
        }
        description="Sign in, run one command, and Bematist reads your local Claude Code, Cursor, and Codex sessions to produce your real card."
      />
      <OgStatRow
        stats={[
          { label: "One-shot token", value: "Star → generate" },
          { label: "Reads locally", value: "JSONL · SQLite" },
          { label: "Leaves your box", value: "Aggregates only" },
        ]}
      />
    </OgFrame>,
    { ...OG_SIZE },
  );
}
