import "server-only";
import { getDbClients } from "@/lib/db";
import type { CardData } from "./card-utils";

/**
 * Server-side card loader shared by:
 *   - apps/web/app/(marketing)/card/[id]/page.tsx          (generateMetadata)
 *   - apps/web/app/(marketing)/card/[id]/opengraph-image.tsx
 *
 * The RSC path for card rendering (`CardPage.tsx`) goes through
 * `/api/card/:id` and doesn't touch this module. Returns null on
 * "not found" or any DB error so marketing SEO falls back to demo data
 * rather than 500'ing.
 */
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
  try {
    const { pg } = getDbClients();
    // card_id is always stored lowercased at mint time. Lowercase the URL
    // segment so SSR resolves /card/WalidKhori identically to
    // /card/walidkhori.
    const rows = await pg.query<{
      card_id: string;
      stats: CardData["stats"];
      display_name: string | null;
      avatar_url: string | null;
      github_username: string | null;
    }>(
      `SELECT card_id, stats, display_name, avatar_url, github_username
         FROM cards
        WHERE card_id = $1
        LIMIT 1`,
      [id.toLowerCase()],
    );
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
  } catch {
    return null;
  }
}
