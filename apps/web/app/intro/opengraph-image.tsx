import { ImageResponse } from "next/og";
import {
  OG_COLORS,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgFrame,
  OgHeadline,
  OgStatRow,
} from "../(marketing)/_og/chrome";

export const runtime = "nodejs";
export const alt = "Bematist · Build with us — three founding orgs, three months on us";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function IntroOg() {
  return new ImageResponse(
    <OgFrame eyebrow="03 / build with us">
      <OgHeadline
        eyebrow="for engineering leaders · founding cohort"
        title={
          <span style={{ display: "flex", flexWrap: "wrap" }}>
            Build Bematist&nbsp;
            <span
              style={{
                color: OG_COLORS.accent,
                fontStyle: "italic",
                display: "flex",
              }}
            >
              with us.
            </span>
          </span>
        }
        description="Three orgs. Three months. On us. You bring a team and real workloads — we bring the onboarding and ship the roadmap your engineers actually need."
      />
      <OgStatRow
        stats={[
          { label: "Pilot", value: "Three months · on us" },
          { label: "Seats", value: "3 founding orgs" },
          { label: "Support", value: "24/7 from founders" },
        ]}
      />
    </OgFrame>,
    { ...OG_SIZE },
  );
}
