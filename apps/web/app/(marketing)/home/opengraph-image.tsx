import { ImageResponse } from "next/og";
import { OG_COLORS, OG_CONTENT_TYPE, OG_SIZE, OgFrame, OgHeadline, OgStatRow } from "../_og/chrome";

export const runtime = "nodejs";
export const alt = "Bematist — open-source analytics for AI-assisted engineering";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function HomeOg() {
  return new ImageResponse(
    <OgFrame eyebrow="01 / landing">
      <OgHeadline
        eyebrow="see what AI is shipping"
        title={
          <span style={{ display: "flex", flexWrap: "wrap" }}>
            See what AI is&nbsp;
            <span
              style={{
                color: OG_COLORS.accent,
                fontStyle: "italic",
                display: "flex",
              }}
            >
              actually shipping.
            </span>
          </span>
        }
        description="Bematist instruments your team's coding agents and ties every LLM dollar to the code that merged."
      />
      <OgStatRow
        stats={[
          { label: "Adapters", value: "Claude · Cursor · Codex" },
          { label: "Default tier", value: "Counters + envelopes" },
          { label: "Hosting", value: "Self-host or managed" },
        ]}
      />
    </OgFrame>,
    { ...OG_SIZE },
  );
}
