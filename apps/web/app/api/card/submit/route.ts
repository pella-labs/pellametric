import { NextResponse } from "next/server";
import { z } from "zod";
import { hashCardToken } from "@/lib/card-backend";
import { sql } from "@/lib/db";
import { fetchGithubName } from "@/lib/github-profile";

export const dynamic = "force-dynamic";

// Narrow, strict shape for CLI-submitted stats. Matches CardData.stats in
// apps/web/app/(marketing)/_card/card-utils.ts. Unknown top-level fields
// are rejected. Leaf types are numbers/strings/enums so scripty payloads
// can't reach the renderer.
const numberDict = z.record(z.string(), z.object({ sessions: z.number(), cost: z.number() }));
const toolList = z.array(z.object({ name: z.string().max(120), count: z.number() }));

const statsSchema = z
  .object({
    claude: z
      .object({
        sessions: z.number(),
        cost: z.number(),
        inputTokens: z.number(),
        outputTokens: z.number(),
        cacheReadTokens: z.number(),
        cacheCreateTokens: z.number(),
        cacheSavingsUsd: z.number(),
        models: numberDict,
        topTools: toolList,
        totalToolCalls: z.number().optional(),
        hourDistribution: z.array(z.number()).length(24),
        activeDays: z.number(),
        projects: z
          .array(z.object({ name: z.string().max(200), sessions: z.number(), cost: z.number() }))
          .optional(),
      })
      .strict(),
    codex: z
      .object({
        sessions: z.number(),
        cost: z.number(),
        inputTokens: z.number(),
        cachedInputTokens: z.number(),
        outputTokens: z.number(),
        models: numberDict,
        activeDays: z.number().optional(),
        projects: z
          .array(z.object({ name: z.string().max(200), sessions: z.number(), cost: z.number() }))
          .optional(),
        topTools: toolList.optional(),
        totalToolCalls: z.number().optional(),
        totalReasoningBlocks: z.number().optional(),
        totalWebSearches: z.number().optional(),
      })
      .strict(),
    combined: z
      .object({
        totalCost: z.number(),
        totalSessions: z.number(),
        totalInputTokens: z.number(),
        totalOutputTokens: z.number(),
        totalActiveDays: z.number().optional(),
        dailyDistribution: z
          .array(
            z.object({
              date: z.string().max(40),
              sessions: z.number(),
              cost: z.number(),
              claudeSessions: z.number(),
              codexSessions: z.number(),
              cursorSessions: z.number(),
              gooseSessions: z.number(),
            }),
          )
          .optional(),
      })
      .strict(),
    cursor: z
      .object({
        sessions: z.number(),
        cost: z.number(),
        inputTokens: z.number(),
        outputTokens: z.number(),
        models: numberDict,
        topTools: toolList,
        totalToolCalls: z.number(),
        activeDays: z.number(),
        projects: z.array(z.object({ name: z.string().max(200), sessions: z.number() })),
        totalMessages: z.number(),
        totalLinesAdded: z.number(),
        totalLinesRemoved: z.number(),
        totalFilesCreated: z.number(),
        thinkingTimeMs: z.number(),
        turnTimeMs: z.number(),
        dailyActivity: z.array(
          z.object({ date: z.string().max(40), messages: z.number(), toolCalls: z.number() }),
        ),
        totalTabSuggestedLines: z.number(),
        totalTabAcceptedLines: z.number(),
        totalComposerSuggestedLines: z.number(),
        totalComposerAcceptedLines: z.number(),
      })
      .strict(),
    goose: z
      .object({
        sessions: z.number(),
        cost: z.number(),
        inputTokens: z.number(),
        outputTokens: z.number(),
        models: numberDict,
        providers: numberDict,
        activeDays: z.number(),
        projects: z.array(
          z.object({ name: z.string().max(200), sessions: z.number(), cost: z.number() }),
        ),
      })
      .strict(),
    highlights: z
      .object({
        favoriteModel: z.string().max(200),
        favoriteTool: z.string().max(200),
        peakHour: z.number(),
        peakHourLabel: z.string().max(40),
        personality: z.string().max(200),
        totalToolCalls: z.number(),
        cacheHitRate: z.number(),
        longestStreak: z.number(),
        mostExpensiveSession: z
          .object({
            cost: z.number(),
            model: z.string().max(200),
            project: z.string().max(200),
            date: z.string().max(40),
          })
          .strict()
          .nullable(),
        avgCostPerSession: z.number(),
        avgSessionsPerDay: z.number(),
        mcpServers: z.array(
          z.object({ name: z.string().max(200), totalCalls: z.number(), tools: toolList }),
        ),
        totalMcpCalls: z.number(),
        skillInvocations: z.number(),
        builtinTools: toolList,
        readWriteRatio: z
          .object({ reads: z.number(), writes: z.number(), ratio: z.string().max(40) })
          .strict(),
        costWithoutCache: z.number(),
        activityCategories: z.array(
          z.object({
            category: z.string().max(200),
            description: z.string().max(500),
            sessions: z.number(),
            cost: z.number(),
            sessionPct: z.number(),
            costPct: z.number(),
          }),
        ),
      })
      .strict(),
  })
  .strict();

/**
 * POST /api/card/submit — CLI contract:
 *   `Authorization: Bearer <token>`, validated stats payload,
 *   `{ cardUrl, cardId }` response. Single-use token claim is atomic.
 */
export async function POST(req: Request) {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing or invalid Authorization header" }, { status: 401 });
  }
  // Trim trailing \r/\n from clipboard paste on Windows / PowerShell stdin.
  const token = header.split("Bearer ")[1]?.trim();
  if (!token) return NextResponse.json({ error: "Missing or invalid Authorization header" }, { status: 401 });
  const tokenHash = hashCardToken(token);

  const body = await req.json().catch(() => null);
  const parse = statsSchema.safeParse(body);
  if (!parse.success) {
    return NextResponse.json(
      { error: "Invalid stats payload", issues: parse.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const serialized = JSON.stringify(parse.data);
  if (serialized.length > 500 * 1024) {
    return NextResponse.json({ error: "Stats payload too large (max 500KB)" }, { status: 400 });
  }

  // Atomic single-use claim. 0-row return = unknown / used / expired; we
  // don't distinguish — one error message so an attacker can't probe.
  const claimed = await sql<{ subject_id: string; subject_kind: string; github_username: string | null }[]>`
    UPDATE card_tokens
       SET used_at = now()
     WHERE token_hash = ${tokenHash}
       AND used_at IS NULL
       AND expires_at > now()
    RETURNING subject_id, subject_kind, github_username`;
  const row = claimed[0];
  if (!row) return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });

  const cardId = row.subject_id;
  const login = row.github_username ?? row.subject_id;
  const displayName = (await fetchGithubName(login)) ?? `@${login}`;
  const avatarUrl = `https://github.com/${login}.png`;

  // Upsert so re-submitting (after minting a fresh token) replaces the card.
  // Pass the payload as a text param cast to jsonb server-side. `sql.json()`
  // routes through postgres-js's jsonb-param encoder, which crashes under
  // Bun's net.Socket with `TypeError: Received an instance of Object` in
  // readableAddChunkPushByteMode. Casting in SQL keeps the param text-typed.
  await sql`
    INSERT INTO cards
      (card_id, owner_user_id, github_username, display_name, avatar_url, stats, created_at)
    VALUES
      (${cardId}, ${null}, ${row.github_username}, ${displayName}, ${avatarUrl}, ${JSON.stringify(parse.data)}::jsonb, now())
    ON CONFLICT (card_id) DO UPDATE SET
      owner_user_id   = EXCLUDED.owner_user_id,
      github_username = EXCLUDED.github_username,
      display_name    = EXCLUDED.display_name,
      avatar_url      = EXCLUDED.avatar_url,
      stats           = EXCLUDED.stats,
      created_at      = EXCLUDED.created_at`;

  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  return NextResponse.json({ cardUrl: `${baseUrl}/card/${cardId}`, cardId });
}
