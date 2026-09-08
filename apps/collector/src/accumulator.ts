import type { IngestPrompt, IngestResponse, IngestSession } from "@pella/shared";
import type { RepoInfo } from "./parsers/repo";
import { resolveBranch } from "./parsers/repo";
import type { SessionMap, SessionState } from "./types";

/**
 * Convert accumulator state into the on-wire shape. Sessions whose cwd
 * can't be resolved to a known github repo are dropped — the ingest
 * endpoint would reject them with "no membership for this org" anyway,
 * and we'd rather not pay the round-trip.
 *
 * Pass `only` to finalize a subset (the "dirty" sids from an
 * incremental tick). Omitting it finalizes every session in the map.
 */
export function finalizeSessions(
  sessions: SessionMap,
  resolveRepoFn: (cwd: string) => RepoInfo | null,
  only?: ReadonlySet<string>,
): { sessions: IngestSession[]; prompts: IngestPrompt[]; responses: IngestResponse[] } {
  const out: IngestSession[] = [];
  const prompts: IngestPrompt[] = [];
  const responses: IngestResponse[] = [];
  for (const s of sessions.values()) {
    if (only && !only.has(s.sid)) continue;
    if (!s.start || !s.end || !s.cwd) continue;
    const info = resolveRepoFn(s.cwd);
    if (!info) continue;
    out.push(toWire(s, info));
    for (const p of s.prompts) {
      prompts.push({
        externalSessionId: s.sid,
        tsPrompt: p.ts.toISOString(),
        text: p.text,
        wordCount: p.wordCount,
      });
    }
    for (const r of s.responses) {
      responses.push({
        externalSessionId: s.sid,
        tsResponse: r.ts.toISOString(),
        text: r.text,
        wordCount: r.wordCount,
      });
    }
  }
  return { sessions: out, prompts, responses };
}

function toWire(s: SessionState, info: RepoInfo): IngestSession {
  const pw = s.promptWords.slice().sort((a, b) => a - b);
  const median = pw.length ? pw[Math.floor(pw.length / 2)] : 0;
  const p95 = pw.length ? pw[Math.min(pw.length - 1, Math.floor(pw.length * 0.95))] : 0;
  // Insights revamp (P9, P14): capture branch + canonical cwd-resolved repo.
  const branch = s.cwd ? resolveBranch(s.cwd) ?? undefined : undefined;
  const cwdResolvedRepo = `${info.owner}/${info.repo}`;
  return {
    externalSessionId: s.sid,
    repo: cwdResolvedRepo,
    provider: info.provider,
    cwd: s.cwd,
    branch,
    cwdResolvedRepo,
    startedAt: s.start!.toISOString(),
    endedAt: s.end!.toISOString(),
    model: s.model,
    tokensIn: s.tokensIn,
    tokensOut: s.tokensOut,
    tokensCacheRead: s.tokensCacheRead,
    tokensCacheWrite: s.tokensCacheWrite,
    tokensReasoning: s.tokensReasoning,
    messages: s.messages,
    userTurns: s.userTurns,
    errors: s.errors,
    filesEdited: [...s.filesEdited],
    toolHist: s.toolHist,
    skillsUsed: [...s.skillsUsed],
    mcpsUsed: [...s.mcpsUsed],
    intentTop: topIntent(s.intents),
    isSidechain: s.isSidechain,
    teacherMoments: s.teacherMoments,
    frustrationSpikes: s.frustrationSpikes,
    promptWordsMedian: median,
    promptWordsP95: p95,
  };
}

function topIntent(intents: Record<string, number>): string | undefined {
  let best: [string, number] | null = null;
  for (const e of Object.entries(intents)) {
    if (!best || e[1] > best[1]) best = e;
  }
  return best?.[0];
}
