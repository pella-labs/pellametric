import type { Metadata } from "next";
import { CardMount } from "../_card/CardMount";
import { DEMO_CARD } from "../_card/demo-data";
import { GetStarted } from "../_components/GetStarted";

const CARD_TITLE = "Bematist · Get your card";
const CARD_DESCRIPTION =
  "Plug in your Claude Code and Codex history. Parsed on your device — totals only, no prompts, no code. Get your shareable card.";

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
        <h1>Get your card.</h1>
        <p>
          Sign in, star, run one command. Your Claude and Codex history becomes a shareable card.
          Totals only — no prompts, no code.
        </p>
        <GetStarted />
      </div>
      <div className="mk-demo-card-host">
        <CardMount demoData={DEMO_CARD} />
      </div>
    </section>
  );
}
