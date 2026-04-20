import { ImageResponse } from "next/og";
import {
  OG_COLORS,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgFrame,
  OgHeadline,
  OgStatRow,
} from "../_og/chrome";

export const runtime = "nodejs";
export const alt = "Bematist — open-source analytics for AI-assisted engineering";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function HomeOg() {
  return new ImageResponse(
    <OgFrame eyebrow="01 / landing">
      <OgHeadline
        eyebrow="for engineering teams · self-host first"
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
        description="Open-source analytics for AI-assisted engineering. Parsed on your team's machines — only the aggregate stats reach your dashboard."
      />
      <OgStatRow
        stats={[
          { label: "Adapters", value: "Claude · Codex" },
          { label: "Where it runs", value: "On your infra" },
          { label: "What's stored", value: "Aggregates only" },
        ]}
      />
    </OgFrame>,
    { ...OG_SIZE },
  );
}
