import type { Metadata } from "next";
import { CardMount } from "../../_card/CardMount";
import { DEMO_CARD } from "../../_card/demo-data";
import { loadCardServer } from "../../_card/load-card-server";

type Params = { id: string };

async function loadOwnerName(id: string): Promise<string | null> {
  if (id === "demo") return DEMO_CARD.user?.displayName ?? "Demo Developer";
  const card = await loadCardServer(id);
  if (!card) return null;
  const displayName = card.user?.displayName ?? null;
  const githubUsername = card.user?.githubUsername ?? null;
  return displayName ?? (githubUsername ? `@${githubUsername}` : null);
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  const owner = await loadOwnerName(id);
  const possessive = owner ? (/[sS]$/.test(owner) ? `${owner}'` : `${owner}'s`) : null;
  const title = possessive ? `${possessive} Bematist card` : "Bematist Card";
  const description = owner
    ? `${owner}'s coding-agent activity over the last 60 days — captured locally, shared on their terms.`
    : "A shareable snapshot of a developer's coding-agent activity. Captured locally, shared on the developer's terms.";
  return {
    title,
    description,
    alternates: { canonical: `/card/${id}` },
    openGraph: {
      type: "profile",
      url: `/card/${id}`,
      title,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default function CardByIdPage() {
  return (
    <section className="mk-card-by-id">
      <CardMount />
    </section>
  );
}
