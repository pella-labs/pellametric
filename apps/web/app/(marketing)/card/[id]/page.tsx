import type { Metadata } from "next";
import { CardMount } from "../../_card/CardMount";

export const metadata: Metadata = {
  title: "Bematist Card",
  description: "A private, shareable snapshot of a developer's coding-agent activity.",
};

export default function CardByIdPage() {
  return (
    <section style={{ padding: "40px 24px", minHeight: "80vh" }}>
      <CardMount />
    </section>
  );
}
