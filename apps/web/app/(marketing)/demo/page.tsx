import type { Metadata } from "next";
import { CardMount } from "../_card/CardMount";
import { DEMO_CARD } from "../_card/demo-data";
import { GetStarted } from "../_components/GetStarted";

const DEMO_TITLE = "Try Bematist · Grab your card";
const DEMO_DESCRIPTION =
  "Grab your personal Bematist card in 30 seconds from local Claude Code, Cursor, and Codex sessions — then unlock the full dashboard your team will actually use.";

export const metadata: Metadata = {
  title: DEMO_TITLE,
  description: DEMO_DESCRIPTION,
  alternates: { canonical: "/demo" },
  openGraph: {
    type: "website",
    url: "/demo",
    title: DEMO_TITLE,
    description: DEMO_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: DEMO_TITLE,
    description: DEMO_DESCRIPTION,
  },
};

export default function DemoPage() {
  return (
    <section className="mk-demo">
      <div>
        <div className="mk-sys" style={{ marginBottom: 16 }}>
          {"SYS.DEMO // personal card"}
        </div>
        <h1>Your card is the hook.</h1>
        <p>
          The card on the right is demo data. Sign in, star the repo, generate a one-shot token, and
          Bematist produces yours from local Claude Code, Cursor, and Codex sessions. Only
          aggregated numbers leave your machine.
        </p>
        <GetStarted />
      </div>
      <div className="mk-demo-card-host">
        <CardMount demoData={DEMO_CARD} />
      </div>
    </section>
  );
}
