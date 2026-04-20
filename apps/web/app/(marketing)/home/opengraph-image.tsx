import { ImageResponse } from "next/og";
import { OG_COLORS, OG_CONTENT_TYPE, OG_SIZE, OgFrame, OgHeadline, OgStatRow } from "../_og/chrome";

export const runtime = "nodejs";
export const alt =
  "Bematist — measure agentic engineering output: see the spend, see the work, scale what ships";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function HomeOg() {
  return new ImageResponse(
    <OgFrame eyebrow="01 / landing">
      <OgHeadline
        eyebrow="open-source ai-engineering analytics"
        title={
          <span style={{ display: "flex", flexWrap: "wrap" }}>
            Measure agentic engineering&nbsp;
            <span
              style={{
                color: OG_COLORS.accent,
                fontStyle: "italic",
                display: "flex",
              }}
            >
              output.
            </span>
          </span>
        }
        description="See the spend. See the work. Scale what ships. Open-source analytics across Claude Code, Codex and the rest of your dev-AI stack."
      />
      <OgStatRow
        stats={[
          { label: "Spend", value: "See the spend" },
          { label: "Work", value: "See the work" },
          { label: "Scale", value: "Scale what ships" },
        ]}
      />
    </OgFrame>,
    { ...OG_SIZE },
  );
}
