import type { Metadata } from "next";
import { CardMount } from "../_card/CardMount";
import { DEMO_CARD } from "../_card/demo-data";
import { GetStarted } from "../_components/GetStarted";

export const metadata: Metadata = {
  title: "Try Bematist · Generate your card",
  description:
    "Preview a Bematist card with demo data, then sign in to generate your own from local Claude Code, Cursor, and Codex sessions.",
};

export default function DemoPage() {
  return (
    <section className="mk-demo">
      <div>
        <div className="mk-sys" style={{ marginBottom: 16 }}>
          SYS.DEMO // personal card
        </div>
        <h1>See yours, then share it.</h1>
        <p>
          The card on the right is demo data. Sign in, star the repo, and
          generate a one-shot token. Run the command locally and Bematist reads
          your Claude Code, Cursor, and Codex sessions to produce your real
          card. Only aggregated numbers leave your machine.
        </p>
        <GetStarted />
      </div>
      <div className="mk-demo-card-host">
        <CardMount demoData={DEMO_CARD} />
      </div>
    </section>
  );
}
