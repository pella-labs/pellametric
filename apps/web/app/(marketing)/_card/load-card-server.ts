import "server-only";
import { sql } from "@/lib/db";
import type { CardData } from "./card-utils";
import { DEMO_CARD } from "./demo-data";

export type LoadedCard = {
  cardId: string;
  stats: CardData["stats"];
  user: {
    displayName: string | null;
    githubUsername: string | null;
    photoURL: string | null;
  } | null;
};

export async function loadCardServer(id: string): Promise<LoadedCard | null> {
  if (id === "demo") {
    return {
      cardId: DEMO_CARD.cardId,
      stats: DEMO_CARD.stats,
      user: DEMO_CARD.user
        ? {
            displayName: DEMO_CARD.user.displayName ?? null,
            githubUsername: DEMO_CARD.user.githubUsername ?? null,
            photoURL: DEMO_CARD.user.photoURL ?? null,
          }
        : null,
    };
  }
  const slug = id.toLowerCase();
  const rows = await sql<
    {
      card_id: string;
      stats: CardData["stats"];
      display_name: string | null;
      avatar_url: string | null;
      github_username: string | null;
    }[]
  >`
    SELECT card_id, stats, display_name, avatar_url, github_username
      FROM cards
     WHERE card_id = ${slug}
     LIMIT 1`;
  const r = rows[0];
  if (!r) return null;
  const hasUser = Boolean(r.display_name || r.avatar_url || r.github_username);
  return {
    cardId: r.card_id,
    stats: r.stats,
    user: hasUser
      ? {
          displayName: r.display_name,
          githubUsername: r.github_username,
          photoURL: r.avatar_url,
        }
      : null,
  };
}
