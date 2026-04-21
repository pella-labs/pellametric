import { describe, it, expect } from "vitest";
import { z } from "zod";

// Mirror of the schema in app/api/ingest/route.ts — keep in sync
const sessionSchema = z.object({
  externalSessionId: z.string(),
  repo: z.string(),
  cwd: z.string().optional(),
  startedAt: z.string(),
  endedAt: z.string(),
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

describe("ingest schema", () => {
  it("accepts minimal valid payload", () => {
    const result = ingestSchema.safeParse({
      source: "claude",
      sessions: [{
        externalSessionId: "abc",
        repo: "pella-labs/bematist",
        startedAt: "2026-04-10T00:00:00Z",
        endedAt: "2026-04-10T00:01:00Z",
      }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown source", () => {
    const r = ingestSchema.safeParse({ source: "gpt", sessions: [] });
    expect(r.success).toBe(false);
  });

  it("rejects string tokens", () => {
    const r = ingestSchema.safeParse({
      source: "claude",
      sessions: [{
        externalSessionId: "x",
        repo: "o/r",
        startedAt: "2026-04-10T00:00:00Z",
        endedAt: "2026-04-10T00:01:00Z",
        tokensOut: "not-a-number",
      }],
    });
    expect(r.success).toBe(false);
  });

  it("accepts toolHist as Record<string, number> (zod 4 syntax)", () => {
    const r = ingestSchema.safeParse({
      source: "claude",
      sessions: [{
        externalSessionId: "x",
        repo: "o/r",
        startedAt: "2026-04-10T00:00:00Z",
        endedAt: "2026-04-10T00:01:00Z",
        toolHist: { Read: 5, Bash: 3 },
      }],
    });
    expect(r.success).toBe(true);
  });

  it("applies defaults for missing fields", () => {
    const r = ingestSchema.parse({
      source: "codex",
      sessions: [{
        externalSessionId: "x",
        repo: "o/r",
        startedAt: "2026-04-10T00:00:00Z",
        endedAt: "2026-04-10T00:01:00Z",
      }],
    });
    expect(r.sessions[0].tokensIn).toBe(0);
    expect(r.sessions[0].filesEdited).toEqual([]);
    expect(r.sessions[0].toolHist).toEqual({});
    expect(r.sessions[0].isSidechain).toBe(false);
  });
});
