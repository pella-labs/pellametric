// POST /api/ingest
// Authorization: Bearer pm_xxx
// Body:  { source: "claude"|"codex", collectorVersion?: string,
//          sessions: Array<IngestSession> }
//
// IngestSession matches packages/shared types. We look up the user by token hash,
// resolve each session's repo -> org (must have membership), then upsert session rows.

import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { NextResponse, after } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { encryptPrompt, getOrCreateUserDek } from "@/lib/crypto/prompts";
import { refreshDailyUserStats } from "@/lib/insights/refresh-daily-user-stats";

const sessionSchema = z.object({
  externalSessionId: z.string(),
  repo: z.string(),                           // "ownerPath/name" — ownerPath may contain '/' for gitlab subgroups
  provider: z.enum(["github", "gitlab"]).optional(),  // defaults to 'github' for back-compat
  cwd: z.string().optional(),
  branch: z.string().optional(),                       // P9
  cwdResolvedRepo: z.string().optional(),              // P14
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

const promptSchema = z.object({
  externalSessionId: z.string(),
  tsPrompt: z.string(),
  text: z.string(),
  wordCount: z.number().int().nonnegative().default(0),
});

const responseSchema = z.object({
  externalSessionId: z.string(),
  tsResponse: z.string(),
  text: z.string(),
  wordCount: z.number().int().nonnegative().default(0),
});

const ingestSchema = z.object({
  source: z.enum(["claude", "codex", "cursor"]),
  collectorVersion: z.string().optional(),
  sessions: z.array(sessionSchema),
  prompts: z.array(promptSchema).optional(),
  responses: z.array(responseSchema).optional(),
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

  // Resolve repo -> orgId via (provider, slug) and user's memberships.
  //   GitHub: exact match on owner == slug.
  //   GitLab: longest-prefix match on ownerPath (allows subgroups to live as
  //           separate orgs while a parent org claims everything else).
  // See docs/multi-provider.md §8.
  const memberships = await db
    .select({
      orgId: schema.membership.orgId,
      slug: schema.org.slug,
      provider: schema.org.provider,
      promptRetentionDays: schema.org.promptRetentionDays,
    })
    .from(schema.membership)
    .innerJoin(schema.org, eq(schema.membership.orgId, schema.org.id))
    .where(eq(schema.membership.userId, userId));

  const githubByExact = new Map<string, string>();
  const gitlabByExact = new Map<string, string>();
  const gitlabSlugsLower: { slug: string; orgId: string }[] = [];
  const retentionByOrgId = new Map<string, number>();
  for (const m of memberships) {
    const lc = m.slug.toLowerCase();
    retentionByOrgId.set(m.orgId, Math.min(365, Math.max(7, m.promptRetentionDays ?? 30)));
    if (m.provider === "gitlab") {
      gitlabByExact.set(lc, m.orgId);
      gitlabSlugsLower.push({ slug: lc, orgId: m.orgId });
    } else {
      githubByExact.set(lc, m.orgId);
    }
  }
  // Sort GitLab slugs by length desc so longest-prefix scan finds most-specific first.
  gitlabSlugsLower.sort((a, b) => b.slug.length - a.slug.length);

  function resolveOrgId(provider: "github" | "gitlab", repo: string): string | null {
    const lastSlash = repo.lastIndexOf("/");
    if (lastSlash < 1) return null;
    const ownerPathLower = repo.slice(0, lastSlash).toLowerCase();
    if (provider === "github") {
      return githubByExact.get(ownerPathLower) ?? null;
    }
    // GitLab: exact, then longest prefix that matches under '/' boundary.
    const exact = gitlabByExact.get(ownerPathLower);
    if (exact) return exact;
    for (const cand of gitlabSlugsLower) {
      if (ownerPathLower === cand.slug || ownerPathLower.startsWith(cand.slug + "/")) {
        return cand.orgId;
      }
    }
    return null;
  }

  let inserted = 0;
  const accepted: string[] = [];
  const rejected: Array<{ repo: string; reason: string }> = [];

  for (const s of body.sessions) {
    const provider = s.provider ?? "github";
    const lastSlash = s.repo.lastIndexOf("/");
    if (lastSlash < 1) { rejected.push({ repo: s.repo, reason: "bad repo format" }); continue; }
    const name = s.repo.slice(lastSlash + 1);
    if (!name) { rejected.push({ repo: s.repo, reason: "bad repo format" }); continue; }
    const orgId = resolveOrgId(provider, s.repo);
    if (!orgId) { rejected.push({ repo: s.repo, reason: "no membership for this org" }); continue; }

    const row = {
      userId,
      orgId,
      provider,
      source: body.source,
      externalSessionId: s.externalSessionId,
      repo: s.repo,
      cwd: s.cwd ?? null,
      branch: s.branch ?? null,
      cwdResolvedRepo: s.cwdResolvedRepo ?? null,
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
          branch: row.branch,
          cwdResolvedRepo: row.cwdResolvedRepo,
        },
      });
    inserted++;
    accepted.push(s.externalSessionId);
  }

  // Encrypt + store prompts and responses, but only for sessions we accepted.
  let promptsInserted = 0;
  let responsesInserted = 0;
  const anyEncryptedPayload =
    (body.prompts && body.prompts.length > 0) || (body.responses && body.responses.length > 0);
  if (anyEncryptedPayload && accepted.length > 0) {
    const acceptedSet = new Set(accepted);
    const sidToOrg = new Map<string, string>();
    for (const s of body.sessions) {
      if (!acceptedSet.has(s.externalSessionId)) continue;
      const provider = s.provider ?? "github";
      const oid = resolveOrgId(provider, s.repo);
      if (oid) sidToOrg.set(s.externalSessionId, oid);
    }
    const dek = await getOrCreateUserDek(userId);
    if (body.prompts) {
      for (const p of body.prompts) {
        const orgId = sidToOrg.get(p.externalSessionId);
        if (!orgId) continue;
        const enc = encryptPrompt(dek, p.text);
        try {
          const retentionDays = retentionByOrgId.get(orgId) ?? 30;
          const expiresAt = new Date(Date.now() + (retentionDays * 24 * 60 * 60 * 1000));
          await db.insert(schema.promptEvent).values({
            userId, orgId,
            source: body.source,
            externalSessionId: p.externalSessionId,
            tsPrompt: new Date(p.tsPrompt),
            wordCount: p.wordCount,
            iv: enc.iv, tag: enc.tag, ciphertext: enc.ciphertext,
            expiresAt,
          }).onConflictDoNothing();
          promptsInserted++;
        } catch { /* skip malformed */ }
      }
    }
    if (body.responses) {
      for (const r of body.responses) {
        const orgId = sidToOrg.get(r.externalSessionId);
        if (!orgId) continue;
        const enc = encryptPrompt(dek, r.text);
        try {
          const retentionDays = retentionByOrgId.get(orgId) ?? 30;
          const expiresAt = new Date(Date.now() + (retentionDays * 24 * 60 * 60 * 1000));
          await db.insert(schema.responseEvent).values({
            userId, orgId,
            source: body.source,
            externalSessionId: r.externalSessionId,
            tsResponse: new Date(r.tsResponse),
            wordCount: r.wordCount,
            iv: enc.iv, tag: enc.tag, ciphertext: enc.ciphertext,
            expiresAt,
          }).onConflictDoNothing();
          responsesInserted++;
        } catch { /* skip malformed */ }
      }
    }
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

  // Phase 3 T3.6 (H9 fix): rollup refresh after the response is flushed.
  // Previously this was a fire-and-forget `void promise` which can be cut off
  // when the runtime ends the request. `after()` keeps work alive past the
  // response on serverless and on the long-running Node server alike.
  const touched = new Map<string, Set<string>>();
  const acceptedSet = new Set(accepted);
  for (const s of body.sessions) {
    if (!acceptedSet.has(s.externalSessionId)) continue;
    const orgIdForSession = resolveOrgId(s.provider ?? "github", s.repo);
    if (!orgIdForSession) continue;
    const k = `${userId}|${orgIdForSession}`;
    if (!touched.has(k)) touched.set(k, new Set());
    const days = touched.get(k)!;
    days.add(new Date(s.startedAt).toISOString().slice(0, 10));
    days.add(new Date(s.endedAt).toISOString().slice(0, 10));
  }
  if (touched.size > 0) {
    after(async () => {
      for (const [k, daysSet] of touched) {
        const [uid, oid] = k.split("|");
        try {
          await refreshDailyUserStats(uid, oid, Array.from(daysSet));
        } catch (err) {
          console.error("refresh-daily-user-stats failed", err);
        }
      }
    });
  }

  return NextResponse.json({ inserted, accepted: accepted.length, rejected, promptsInserted, responsesInserted });
}
