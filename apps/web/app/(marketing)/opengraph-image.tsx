import { ImageResponse } from "next/og";
import { OG_CONTENT_TYPE, OG_SIZE, OgCover, OgFrame } from "./_og/chrome";

export const runtime = "nodejs";
export const alt = "Telemetryc — measure AI-assisted engineering";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function HomeOg() {
  return new ImageResponse(
    <OgFrame>
      <OgCover title="Telemetryc." beats={["See the spend.", "See the work."]} />
    </OgFrame>,
    { ...OG_SIZE },
  );
}
