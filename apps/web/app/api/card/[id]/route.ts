import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/card/:id — public read of a minted card. Response shape (LOCKED,
 * consumed by `app/(marketing)/_card/CardPage.tsx`):
 *   { cardId, stats, user: { displayName, photoURL, githubUsername } | null, createdAt }
 *
 * Display metadata is denormalized onto `cards` — no auth-table join, so the
 * public page still renders if the owning user is deleted.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // card_id is stored lowercased at mint time, so /card/WalidKhori resolves
  // identically to /card/walidkhori.
  const slug = id.toLowerCase();

  const rows = await sql<
    {
      card_id: string;
      stats: unknown;
      display_name: string | null;
      avatar_url: string | null;
      github_username: string | null;
      created_at: Date;
    }[]
  >`
    SELECT card_id, stats, display_name, avatar_url, github_username, created_at
      FROM cards
     WHERE card_id = ${slug}
     LIMIT 1`;
  const r = rows[0];
  if (!r) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const hasUser = Boolean(r.display_name || r.avatar_url || r.github_username);
  return NextResponse.json({
    cardId: r.card_id,
    stats: r.stats,
    user: hasUser
      ? {
          displayName: r.display_name,
          photoURL: r.avatar_url,
          githubUsername: r.github_username,
        }
      : null,
    createdAt: r.created_at,
  });
}
