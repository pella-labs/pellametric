import { ImageResponse } from "next/og";
import { OG_CONTENT_TYPE, OG_SIZE, OgCover, OgFrame } from "../_og/chrome";

export const runtime = "nodejs";
export const alt = "Telemetryc — your year in prompts, parsed on device";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function CardOg() {
  return new ImageResponse(
    <OgFrame>
      <OgCover title="Your year in prompts." beats={["Parsed on device.", "No code leaves."]} />
    </OgFrame>,
    { ...OG_SIZE },
  );
}
