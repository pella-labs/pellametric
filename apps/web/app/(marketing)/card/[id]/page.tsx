import type { Metadata } from "next";
import { db, firebaseConfigured } from "@/lib/firebase/admin";
import { CardMount } from "../../_card/CardMount";
import { DEMO_CARD } from "../../_card/demo-data";

type Params = { id: string };

async function loadOwnerName(id: string): Promise<string | null> {
  if (id === "demo") return DEMO_CARD.user?.displayName ?? "Demo Developer";
  if (!firebaseConfigured) return null;
  try {
    const card = await db.collection("cards").doc(id).get();
    if (!card.exists) return null;
    const { uid } = card.data() as { uid: string };
    const user = await db.collection("users").doc(uid).get();
    if (!user.exists) return null;
    const u = user.data() as {
      displayName?: string;
      githubUsername?: string;
    };
    return u.displayName ?? (u.githubUsername ? `@${u.githubUsername}` : null);
  } catch {
    return null;
  }
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
    <section style={{ padding: "40px 24px", minHeight: "80vh" }}>
      <CardMount />
    </section>
  );
}
