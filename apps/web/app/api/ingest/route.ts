// POST /api/ingest
// Authorization: Bearer pm_xxx
// Body:  { source: "claude"|"codex", collectorVersion?: string,
//          sessions: Array<IngestSession> }
//
// IngestSession matches packages/shared types. We look up the user by token hash,
// resolve each session's repo -> org (must have membership), then upsert session rows.

import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";

const sessionSchema = z.object({
  externalSessionId: z.string(),
  repo: z.string(),                           // "owner/name"
  cwd: z.string().optional(),
  startedAt: z.string(),                      // ISO
  endedAt: z.string(),                        // ISO
  model: z.string().optional(),
  tokensIn: z.number().int().nonnegative().default(0),
  tokensOut: z.number().int().nonnegative().default(0),
  tokensCacheRead: z.number().int().nonnegative().default(0),
  tokensCacheWrite: z.number().int().nonnegative().default(0),
  tokensReasoning: z.number().int().nonnegative().default(0),
  messages: z.number().int().nonnegative().default(0),
  userTurns: z.number().int().nonnegative().default(0),
  errors: z.number().int().nonnegative().default(0),
  filesEdited: z.array(z.string()).default([]),
  toolHist: z.record(z.string(), z.number()).default({}),
  skillsUsed: z.array(z.string()).default([]),
  mcpsUsed: z.array(z.string()).default([]),
  intentTop: z.string().optional(),
  isSidechain: z.boolean().default(false),
  teacherMoments: z.number().int().nonnegative().default(0),
  frustrationSpikes: z.number().int().nonnegative().default(0),
  promptWordsMedian: z.number().int().nonnegative().default(0),
  promptWordsP95: z.number().int().nonnegative().default(0),
});

const ingestSchema = z.object({
  source: z.enum(["claude", "codex"]),
  collectorVersion: z.string().optional(),
  sessions: z.array(sessionSchema),
});

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: "missing bearer token" }, { status: 401 });

  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const [tk] = await db.select().from(schema.apiToken).where(eq(schema.apiToken.tokenHash, hash)).limit(1);
  if (!tk || tk.revokedAt) return NextResponse.json({ error: "invalid token" }, { status: 401 });

  const userId = tk.userId;
  const parsed = ingestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "validation", issues: parsed.error.issues.slice(0, 10) }, { status: 400 });
  }
  const body = parsed.data;

  // resolve repo -> orgId via org slug (owner) and user's memberships
  const memberships = await db
    .select({ orgId: schema.membership.orgId, slug: schema.org.slug, orgRow: schema.org })
    .from(schema.membership)
    .innerJoin(schema.org, eq(schema.membership.orgId, schema.org.id))
    .where(eq(schema.membership.userId, userId));
  const slugToOrgId = new Map(memberships.map(m => [m.slug.toLowerCase(), m.orgId]));

  let inserted = 0;
  const accepted: string[] = [];
  const rejected: Array<{ repo: string; reason: string }> = [];

  for (const s of body.sessions) {
    const [owner, name] = s.repo.split("/");
    if (!owner || !name) { rejected.push({ repo: s.repo, reason: "bad repo format" }); continue; }
    const orgId = slugToOrgId.get(owner.toLowerCase());
    if (!orgId) { rejected.push({ repo: s.repo, reason: "no membership for this org" }); continue; }

    const row = {
      userId,
      orgId,
      source: body.source,
      externalSessionId: s.externalSessionId,
      repo: s.repo,
      cwd: s.cwd ?? null,
      startedAt: new Date(s.startedAt),
      endedAt: new Date(s.endedAt),
      model: s.model ?? null,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      tokensCacheRead: s.tokensCacheRead,
      tokensCacheWrite: s.tokensCacheWrite,
      tokensReasoning: s.tokensReasoning,
      messages: s.messages,
      userTurns: s.userTurns,
      errors: s.errors,
      filesEdited: s.filesEdited,
      toolHist: s.toolHist,
      skillsUsed: s.skillsUsed,
      mcpsUsed: s.mcpsUsed,
      intentTop: s.intentTop ?? null,
      isSidechain: s.isSidechain,
      teacherMoments: s.teacherMoments,
      frustrationSpikes: s.frustrationSpikes,
      promptWordsMedian: s.promptWordsMedian,
      promptWordsP95: s.promptWordsP95,
    };

    await db
      .insert(schema.sessionEvent)
      .values(row)
      .onConflictDoUpdate({
        target: [schema.sessionEvent.userId, schema.sessionEvent.source, schema.sessionEvent.externalSessionId],
        set: {
          endedAt: row.endedAt,
          tokensIn: row.tokensIn, tokensOut: row.tokensOut,
          tokensCacheRead: row.tokensCacheRead, tokensCacheWrite: row.tokensCacheWrite,
          tokensReasoning: row.tokensReasoning,
          messages: row.messages, userTurns: row.userTurns, errors: row.errors,
          filesEdited: row.filesEdited, toolHist: row.toolHist,
          skillsUsed: row.skillsUsed, mcpsUsed: row.mcpsUsed,
          intentTop: row.intentTop,
          teacherMoments: row.teacherMoments,
          frustrationSpikes: row.frustrationSpikes,
          promptWordsMedian: row.promptWordsMedian,
          promptWordsP95: row.promptWordsP95,
        },
      });
    inserted++;
    accepted.push(s.externalSessionId);
  }

  // Audit batch (use first matched org or user's first org)
  const anyOrgId = memberships[0]?.orgId;
  if (anyOrgId) {
    await db.insert(schema.uploadBatch).values({
      userId, orgId: anyOrgId, source: body.source,
      sessionCount: body.sessions.length, rowsInserted: inserted,
      collectorVersion: body.collectorVersion ?? null,
    });
  }
  await db.update(schema.apiToken).set({ lastUsedAt: new Date() }).where(eq(schema.apiToken.id, tk.id));

  return NextResponse.json({ inserted, accepted: accepted.length, rejected });
}
