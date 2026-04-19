import type { Metadata } from "next";
import { CardMount } from "../_card/CardMount";
import { DEMO_CARD } from "../_card/demo-data";
import { GetStarted } from "../_components/GetStarted";

const CARD_TITLE = "Try Bematist · Grab your card";
const CARD_DESCRIPTION =
  "Generate your personal Bematist card in 30 seconds from local Claude Code, Cursor, and Codex sessions — a legible view of what AI actually shipped for you this quarter.";

export const metadata: Metadata = {
  title: CARD_TITLE,
  description: CARD_DESCRIPTION,
  alternates: { canonical: "/card" },
  openGraph: {
    type: "website",
    url: "/card",
    title: CARD_TITLE,
    description: CARD_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: CARD_TITLE,
    description: CARD_DESCRIPTION,
    site: "@bematist_dev",
  },
};

export default function CardLandingPage() {
  return (
    <section className="mk-demo">
      <div>
        <div className="mk-sys" style={{ marginBottom: 16 }}>
          {"SYS.CARD // personal card"}
        </div>
        <h1>Your quarter, made legible.</h1>
        <p>
          The card on the right is demo data. Sign in, star the repo, generate a one-shot token, and
          Bematist reads your local Claude Code, Cursor, and Codex sessions to produce yours. Only
          aggregated numbers leave your machine — no prompt text, no code.
        </p>
        <GetStarted />
      </div>
      <div className="mk-demo-card-host">
        <CardMount demoData={DEMO_CARD} />
      </div>
    </section>
  );
}
