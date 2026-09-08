// Hot-path §4.1 — lineage scoring (verbatim from dev-docs/build/01).
import type { sessionEvent, pr } from "@/lib/db/schema";

type SessionRow = typeof sessionEvent.$inferSelect;
type PrRow = typeof pr.$inferSelect;

export type PrCommit = {
  sha: string;
  kind: "commit" | "squash_merge" | "merge_commit";
  authorLogin: string | null;
  authoredAt: Date;
};

export type LineageBucket = "high" | "medium" | "low" | "drop";

export type LineageScore = {
  score: number;
  bucket: LineageBucket;
  cwdMatch: boolean;
  fileJaccard: number;
  timeOverlap: number;
  branchMatch: boolean;
  commitAuthorship: boolean;
  reasonBreakdown: {
    cwdMatch: 0 | 0.6 | 1;
    jaccardRaw: number;
    timeRaw: 0 | 0.5 | 1;
    branchRaw: 0 | 1;
    authorshipRaw: 0 | 1;
    appliedException: boolean;
  };
};

const W_JACCARD = 0.45;
const W_TIME = 0.25;
const W_BRANCH = 0.15;
const W_AUTHOR = 0.15;

const HIGH = 0.7;
const MED = 0.4;
const LOW = 0.15;
const LOW_EXCEPTION = 0.10;

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function scoreLineage(
  session: Pick<SessionRow, "startedAt" | "endedAt" | "filesEdited" | "branch" | "cwdResolvedRepo">,
  pr: Pick<PrRow, "repo" | "fileList" | "createdAt" | "mergedAt" | "headBranch">,
  prCommits: PrCommit[],
  userLogin: string | null,
  prevFilenames: string[] = [],
): LineageScore {
  // Gate: cwd_match. Wrong repo => 0. Unknown => 0.6 (P13). Right => 1.
  let cwdMatchGate: 0 | 0.6 | 1;
  if (session.cwdResolvedRepo === null) cwdMatchGate = 0.6;
  else if (session.cwdResolvedRepo === pr.repo) cwdMatchGate = 1;
  else cwdMatchGate = 0;
  const cwdMatch = cwdMatchGate === 1;

  // File Jaccard against pr.fileList ∪ previousFilenames (P10).
  const sessionFiles = Array.isArray(session.filesEdited) ? (session.filesEdited as string[]) : [];
  const prFiles = Array.isArray(pr.fileList) ? (pr.fileList as string[]) : [];
  const expanded = Array.from(new Set([...prFiles, ...prevFilenames]));
  const jac = jaccard(sessionFiles, expanded);

  // Time overlap.
  const ended = session.endedAt.getTime();
  const created = pr.createdAt.getTime();
  const merged = pr.mergedAt ? pr.mergedAt.getTime() : created;
  const FOUR_H = 4 * 3600 * 1000;
  const ONE_H = 1 * 3600 * 1000;
  const FORTY_EIGHT_H = 48 * 3600 * 1000;
  let timeRaw: 0 | 0.5 | 1 = 0;
  if (ended >= created - FOUR_H && ended <= merged + ONE_H) timeRaw = 1;
  else if (Math.abs(ended - created) <= FORTY_EIGHT_H || Math.abs(ended - merged) <= FORTY_EIGHT_H) timeRaw = 0.5;

  // Branch match — deterministic.
  const branchMatch = !!session.branch && !!pr.headBranch && session.branch === pr.headBranch;
  const branchRaw: 0 | 1 = branchMatch ? 1 : 0;

  // Commit authorship: any prCommit (kind='commit') with matching authorLogin in [startedAt, endedAt+24h].
  const startedMs = session.startedAt.getTime();
  const endedPlus24 = ended + 24 * 3600 * 1000;
  const commitAuthorship = !!userLogin && prCommits.some(c =>
    c.kind === "commit" &&
    c.authorLogin === userLogin &&
    c.authoredAt.getTime() >= startedMs &&
    c.authoredAt.getTime() <= endedPlus24,
  );
  const authorshipRaw: 0 | 1 = commitAuthorship ? 1 : 0;

  const weighted = W_JACCARD * jac + W_TIME * timeRaw + W_BRANCH * branchRaw + W_AUTHOR * authorshipRaw;
  const score = cwdMatchGate * weighted;

  // Threshold exception (P10): cwdMatch && commitAuthorship => drop lowered to 0.10.
  const exceptionApplies = cwdMatch && commitAuthorship;
  const lowFloor = exceptionApplies ? LOW_EXCEPTION : LOW;

  let bucket: LineageBucket;
  if (score >= HIGH) bucket = "high";
  else if (score >= MED) bucket = "medium";
  else if (score >= lowFloor) bucket = "low";
  else bucket = "drop";

  return {
    score,
    bucket,
    cwdMatch,
    fileJaccard: jac,
    timeOverlap: timeRaw,
    branchMatch,
    commitAuthorship,
    reasonBreakdown: {
      cwdMatch: cwdMatchGate,
      jaccardRaw: jac,
      timeRaw,
      branchRaw,
      authorshipRaw,
      appliedException: exceptionApplies,
    },
  };
}
