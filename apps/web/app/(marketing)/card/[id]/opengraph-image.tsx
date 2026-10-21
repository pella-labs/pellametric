import { ImageResponse } from "next/og";
import { loadCardServer } from "../../_card/load-card-server";
import {
  OG_COLORS,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgCover,
  OgFrame,
  OgHeadline,
  OgStatRow,
} from "../../_og/chrome";

export const runtime = "nodejs";
export const alt = "A Telemetryc card — a developer's coding-agent activity at a glance";
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

async function loadCard(id: string): Promise<CardSnapshot | null> {
  if (id === "demo") return null;
  const card = await loadCardServer(id);
  if (!card || !card.user) return null;
  return {
    displayName: card.user.displayName ?? null,
    githubUsername: card.user.githubUsername ?? null,
    totalCost: card.stats.combined.totalCost,
    totalSessions: card.stats.combined.totalSessions,
    activeDays: card.stats.combined.totalActiveDays ?? 0,
    personality: card.stats.highlights?.personality ?? null,
    favoriteTool: card.stats.highlights?.favoriteTool ?? null,
  };
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

  // Demo / unknown / unminted card → render the marketing cover, same as
  // the generic /card OG. Never surface made-up "Demo Developer" stats.
  if (!card) {
    return new ImageResponse(
      <OgFrame>
        <OgCover title="Your year in prompts." beats={["Parsed on device.", "No code leaves."]} />
      </OgFrame>,
      { ...OG_SIZE },
    );
  }

  const owner =
    card.displayName?.trim() || (card.githubUsername ? `@${card.githubUsername}` : null);
  const headlineOwner = owner ? possessive(owner) : "A";

  const days = card.activeDays;
  const daySummary = days > 0 ? `${days} active ${days === 1 ? "day" : "days"}` : "Agent activity";
  const description = card.favoriteTool
    ? `${daySummary} · ${card.favoriteTool}.`
    : `${daySummary}.`;

  return new ImageResponse(
    <OgFrame>
      <OgHeadline
        eyebrow={
          card.personality ? `personality · ${card.personality.toLowerCase()}` : "shareable card"
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
              Telemetryc card.
            </span>
          </span>
        }
        description={description}
      />
      <OgStatRow
        stats={[
          { label: "Spend", value: fmtMoney(card.totalCost) },
          { label: "Sessions", value: fmtCount(card.totalSessions) },
          { label: "Active days", value: `${card.activeDays}` },
        ]}
      />
    </OgFrame>,
    { ...OG_SIZE },
  );
}
