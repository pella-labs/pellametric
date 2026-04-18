import { ImageResponse } from "next/og";
import { db, firebaseConfigured } from "@/lib/firebase/admin";
import { DEMO_CARD } from "../../_card/demo-data";
import {
  OG_COLORS,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgFrame,
  OgHeadline,
  OgStatRow,
} from "../../_og/chrome";

export const runtime = "nodejs";
export const alt = "A Bematist card — a developer's coding-agent activity at a glance";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

type CardSnapshot = {
  displayName: string | null;
  githubUsername: string | null;
  totalCost: number;
  totalSessions: number;
  activeDays: number;
  personality: string | null;
  favoriteTool: string | null;
};

function fallbackFromDemo(): CardSnapshot {
  return {
    displayName: DEMO_CARD.user?.displayName ?? "Demo Developer",
    githubUsername: DEMO_CARD.user?.githubUsername ?? null,
    totalCost: DEMO_CARD.stats.combined.totalCost,
    totalSessions: DEMO_CARD.stats.combined.totalSessions,
    activeDays: DEMO_CARD.stats.combined.totalActiveDays ?? 0,
    personality: DEMO_CARD.stats.highlights?.personality ?? null,
    favoriteTool: DEMO_CARD.stats.highlights?.favoriteTool ?? null,
  };
}

async function loadCard(id: string): Promise<CardSnapshot> {
  if (id === "demo" || !firebaseConfigured) return fallbackFromDemo();
  try {
    const doc = await db.collection("cards").doc(id).get();
    if (!doc.exists) return fallbackFromDemo();
    const data = doc.data() as {
      uid: string;
      stats: typeof DEMO_CARD.stats;
    };
    const userDoc = await db.collection("users").doc(data.uid).get();
    const user = userDoc.exists
      ? (userDoc.data() as {
          displayName?: string;
          githubUsername?: string;
        })
      : null;
    return {
      displayName: user?.displayName ?? null,
      githubUsername: user?.githubUsername ?? null,
      totalCost: data.stats.combined.totalCost,
      totalSessions: data.stats.combined.totalSessions,
      activeDays: data.stats.combined.totalActiveDays ?? 0,
      personality: data.stats.highlights?.personality ?? null,
      favoriteTool: data.stats.highlights?.favoriteTool ?? null,
    };
  } catch {
    return fallbackFromDemo();
  }
}

const fmtMoney = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `$${n.toFixed(n < 10 ? 2 : 0)}`;

const fmtCount = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 10_000
      ? `${Math.round(n / 1000)}k`
      : n.toLocaleString("en-US");

function possessive(name: string) {
  return /[sS]$/.test(name) ? `${name}'` : `${name}'s`;
}

export default async function CardOg({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await loadCard(id);

  const owner =
    card.displayName?.trim() || (card.githubUsername ? `@${card.githubUsername}` : null);
  const headlineOwner = owner ? possessive(owner) : "A";

  return new ImageResponse(
    <OgFrame eyebrow={`card // ${id.slice(0, 12)}`}>
      <OgHeadline
        eyebrow={
          card.personality ? `personality // ${card.personality.toLowerCase()}` : "shareable card"
        }
        title={
          <span style={{ display: "flex", flexWrap: "wrap" }}>
            {headlineOwner}&nbsp;
            <span
              style={{
                color: OG_COLORS.accent,
                fontStyle: "italic",
                display: "flex",
              }}
            >
              Bematist card.
            </span>
          </span>
        }
        description={
          card.favoriteTool
            ? `Sixty days of coding-agent activity. Favorite tool: ${card.favoriteTool}.`
            : "Sixty days of coding-agent activity, captured locally and shared on the developer's terms."
        }
      />
      <OgStatRow
        stats={[
          { label: "Total spend", value: fmtMoney(card.totalCost) },
          { label: "Sessions", value: fmtCount(card.totalSessions) },
          { label: "Active days", value: `${card.activeDays}` },
        ]}
      />
    </OgFrame>,
    { ...OG_SIZE },
  );
}
