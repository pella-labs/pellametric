import { NextResponse } from "next/server";
import { getLocalData } from "@/lib/local-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Peer snapshot endpoint — serves this dashboard's grammata aggregate over
 * HTTP(S) so a teammate's `/teams` page can pull + merge it.
 *
 * Privacy boundary (maps to CLAUDE.md §Privacy Rules D7/D8):
 *   - This endpoint returns ONLY grammata aggregates — session counts,
 *     tokens, cost, tool counts, retry ratios, project/model/branch
 *     rollups, daily series. No prompt text ever touches this response
 *     because grammata itself never parses user-message content.
 *   - Session transcript pages (`/sessions/[source]/[id]`) read raw JSONL
 *     from the LOCAL filesystem. Peers can never reach them; the detail
 *     page is IC-only by construction.
 *   - Shared bearer in env (`BEMATIST_PEER_SECRET`). Not meant for the
 *     public internet — intended for Tailscale-style private networking.
 *
 * The response shape matches what `getLocalData()` already returns, so the
 * peer loader can treat local-vs-peer data identically.
 */
export async function GET(req: Request): Promise<Response> {
  const expected = process.env.BEMATIST_PEER_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "peer endpoint disabled — set BEMATIST_PEER_SECRET to enable" },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const data = await getLocalData();
  // Prune any field that could (in some future adapter version) carry raw
  // text. Grammata doesn't include any today, but be paranoid in case the
  // library starts embedding message samples in an update.
  const safe = {
    claude: data.claude,
    codex: data.codex,
    cursor: data.cursor,
    goose: data.goose,
    analytics: data.analytics,
    sources: data.sources,
    blocks: data.blocks,
    activeBlock: data.activeBlock,
    peakBlockTokens: data.peakBlockTokens,
  };

  return NextResponse.json(safe, {
    headers: {
      "cache-control": "no-store",
      "x-bematist-peer-version": "1",
    },
  });
}
