// F5.41 / T8.7 — Demo seed script. Generates a believable team for screenshots
// and onboarding videos. Idempotent — re-running upserts the same external IDs.
//
// SAFETY: refuses to run against a non-local DATABASE_URL unless DEMO=1 is
// explicitly set. Never run against production.
//
// Usage:
//   cd apps/web && bun run scripts/seed-demo.ts
//   DEMO=1 cd apps/web && bun run scripts/seed-demo.ts   # opt-in for non-local

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const DEMO_ORG_SLUG = "pellametric-demo";
const DEVS = [
  { login: "alex", name: "Alex Demo" },
  { login: "morgan", name: "Morgan Demo" },
  { login: "casey", name: "Casey Demo" },
  { login: "jordan", name: "Jordan Demo" },
  { login: "rowan", name: "Rowan Demo" },
];
const SOURCES = ["claude", "codex", "cursor"] as const;
const INTENTS = ["feature", "bugfix", "refactor", "exploration", "review", "other"];
const REPOS = ["pellametric-demo/api", "pellametric-demo/web", "pellametric-demo/cli"];
const MODELS = ["claude-opus-4-7", "claude-sonnet-4-6", "codex", "claude-haiku-4-5-20251001"];

function assertSafe() {
  const url = process.env.DATABASE_URL ?? "";
  const isLocal = /(?:localhost|127\.0\.0\.1|::1)/.test(url);
  if (!isLocal && process.env.DEMO !== "1") {
    console.error(
      "Refusing to run against a non-local DATABASE_URL. Set DEMO=1 to override (own risk).",
    );
    console.error("DATABASE_URL host:", url.replace(/:[^@]+@/, ":***@").slice(0, 80));
    process.exit(2);
  }
}

function rand<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function rint(a: number, b: number): number {
  return a + Math.floor(Math.random() * (b - a + 1));
}
function daysAgo(d: number, hour = 9 + rint(0, 8)): Date {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() - d);
  t.setUTCHours(hour, rint(0, 59), 0, 0);
  return t;
}

async function ensureOrg(): Promise<string> {
  const existing = await db.query.org.findFirst({
    where: eq(schema.org.slug, DEMO_ORG_SLUG),
  });
  if (existing) return existing.id;
  const [row] = await db
    .insert(schema.org)
    .values({
      slug: DEMO_ORG_SLUG,
      provider: "github",
      name: "Pellametric Demo",
      promptRetentionDays: 30,
    })
    .returning();
  return row.id;
}

async function ensureUser(login: string, name: string): Promise<string> {
  const email = `${login}@pellametric-demo.invalid`;
  const existing = await db.query.user.findFirst({
    where: eq(schema.user.email, email),
  });
  if (existing) return existing.id;
  const id = `demo-${login}`;
  await db.insert(schema.user).values({
    id,
    name,
    email,
    emailVerified: true,
    githubLogin: login,
  });
  return id;
}

async function ensureMembership(orgId: string, userId: string, role: "manager" | "dev") {
  // membership PK is (userId, orgId) per schema; use upsert via select-then-insert.
  const existing = await db.query.membership.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.orgId, orgId)),
  });
  if (existing) return;
  await db.insert(schema.membership).values({ userId, orgId, role });
}

async function seedSessions(orgId: string, userId: string, login: string) {
  for (let i = 0; i < 40; i++) {
    const startedAt = daysAgo(rint(0, 29));
    const wallSec = rint(120, 4 * 3600);
    const endedAt = new Date(startedAt.getTime() + wallSec * 1000);
    const source = rand(SOURCES);
    const tokensIn = rint(1_000, 200_000);
    const tokensOut = rint(2_000, 600_000);
    const externalSessionId = `demo-${login}-${i}`;
    await db
      .insert(schema.sessionEvent)
      .values({
        userId,
        orgId,
        provider: "github",
        source,
        externalSessionId,
        repo: rand(REPOS),
        cwd: null,
        branch: rint(0, 1) === 0 ? null : `feat/${rand(INTENTS)}-${rint(1, 999)}`,
        cwdResolvedRepo: rand(REPOS),
        startedAt,
        endedAt,
        model: rand(MODELS),
        tokensIn,
        tokensOut,
        tokensCacheRead: rint(0, tokensIn * 2),
        tokensCacheWrite: rint(0, 2_000),
        tokensReasoning: rint(0, tokensOut),
        messages: rint(4, 80),
        userTurns: rint(2, 40),
        errors: rint(0, 3) === 0 ? 0 : rint(0, 2),
        filesEdited: [],
        toolHist: {},
        skillsUsed: [],
        mcpsUsed: [],
        intentTop: rand(INTENTS),
        isSidechain: false,
        teacherMoments: rint(0, 3),
        frustrationSpikes: rint(0, 2),
        promptWordsMedian: rint(8, 60),
        promptWordsP95: rint(40, 200),
      })
      .onConflictDoUpdate({
        target: [schema.sessionEvent.userId, schema.sessionEvent.source, schema.sessionEvent.externalSessionId],
        set: { endedAt, tokensIn, tokensOut },
      });
  }
}

async function seedPrs(orgId: string, users: { id: string; login: string }[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < 50; i++) {
    const author = rand(users);
    const repo = rand(REPOS);
    const number = 100 + i;
    const createdAt = daysAgo(rint(1, 28));
    const merged = rint(0, 9) > 1; // ~90% merged
    const mergedAt = merged ? new Date(createdAt.getTime() + rint(1, 72) * 60 * 60 * 1000) : null;
    const kind: "standard" | "revert" = i % 17 === 0 ? "revert" : "standard";
    const stackedOn = i > 0 && i % 23 === 0 ? out[out.length - 1] : null;
    const [pr] = await db
      .insert(schema.pr)
      .values({
        orgId,
        provider: "github",
        repo,
        number,
        title: `${rand(INTENTS)} — demo PR #${number}`,
        authorLogin: author.login,
        state: merged ? "merged" : "open",
        additions: rint(10, 800),
        deletions: rint(0, 300),
        changedFiles: rint(1, 25),
        commits: rint(1, 12),
        createdAt,
        mergedAt,
        url: `https://github.com/${repo}/pull/${number}`,
        fileList: [],
        mergeCommitSha: merged ? randomUUID().replace(/-/g, "").slice(0, 40) : null,
        baseBranch: "main",
        headBranch: `feat/demo-${number}`,
        kind,
        stackedOn,
      })
      .onConflictDoUpdate({
        target: [schema.pr.orgId, schema.pr.repo, schema.pr.number],
        set: { state: merged ? "merged" : "open", mergedAt },
      })
      .returning({ id: schema.pr.id });
    out.push(pr.id);
  }
  return out;
}

async function main() {
  assertSafe();
  console.log("Seeding pellametric-demo …");
  const orgId = await ensureOrg();
  const users: { id: string; login: string }[] = [];
  for (let i = 0; i < DEVS.length; i++) {
    const id = await ensureUser(DEVS[i].login, DEVS[i].name);
    await ensureMembership(orgId, id, i === 0 ? "manager" : "dev");
    users.push({ id, login: DEVS[i].login });
  }
  for (const u of users) {
    await seedSessions(orgId, u.id, u.login);
  }
  const prIds = await seedPrs(orgId, users);
  console.log(`Done. orgId=${orgId} users=${users.length} prs=${prIds.length}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
