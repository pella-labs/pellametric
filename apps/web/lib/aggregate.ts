// Server-side aggregation: takes session_event rows for an org and builds the
// same chart-data shape the static HTML dashboard used.

type Row = {
  source: string;
  repo: string;
  cwd?: string | null;
  startedAt: Date;
  endedAt: Date;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensReasoning: number;
  messages: number;
  userTurns: number;
  errors: number;
  filesEdited: unknown;
  toolHist: unknown;
  skillsUsed: unknown;
  mcpsUsed: unknown;
  intentTop: string | null;
  isSidechain: boolean;
  teacherMoments?: number;
  frustrationSpikes?: number;
  promptWordsMedian?: number;
  promptWordsP95?: number;
};

export type ChartData = ReturnType<typeof aggregate>;

function asArr<T = string>(x: unknown): T[] {
  return Array.isArray(x) ? (x as T[]) : [];
}
function asObj(x: unknown): Record<string, number> {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, number>) : {};
}
function topN<T>(arr: [string, T][], n = 10): [string, T][] {
  return arr.slice(0, n);
}

export function aggregate(rows: Row[], source: "claude" | "codex") {
  const src = rows.filter(r => r.source === source);

  // Totals
  const totals = src.reduce(
    (a, r) => ({
      sessions: a.sessions + 1,
      messages: a.messages + r.messages,
      tokensIn: a.tokensIn + Number(r.tokensIn),
      tokensOut: a.tokensOut + Number(r.tokensOut),
      tokensCacheRead: a.tokensCacheRead + Number(r.tokensCacheRead),
      tokensCacheWrite: a.tokensCacheWrite + Number(r.tokensCacheWrite),
      tokensReasoning: a.tokensReasoning + Number(r.tokensReasoning),
    }),
    { sessions: 0, messages: 0, tokensIn: 0, tokensOut: 0, tokensCacheRead: 0, tokensCacheWrite: 0, tokensReasoning: 0 },
  );

  // Cache hit %
  const cacheDenom = totals.tokensCacheRead + totals.tokensIn + totals.tokensCacheWrite;
  const cacheHitPct = cacheDenom > 0 ? (100 * totals.tokensCacheRead) / cacheDenom : 0;

  // Active hours per day — merged timeline, idle gap >10min collapsed
  const tsByDay = new Map<string, number[]>();
  for (const r of src) {
    const day = r.startedAt.toISOString().slice(0, 10);
    if (!tsByDay.has(day)) tsByDay.set(day, []);
    tsByDay.get(day)!.push(r.startedAt.getTime() / 1000, r.endedAt.getTime() / 1000);
  }
  const hoursEntries: [string, number][] = [];
  for (const [day, ts] of tsByDay) {
    ts.sort((a, b) => a - b);
    let active = 0, prev = ts[0];
    for (let i = 1; i < ts.length; i++) {
      const gap = ts[i] - prev;
      if (gap > 0 && gap < 600) active += gap;
      prev = ts[i];
    }
    hoursEntries.push([day, Math.min(active / 3600, 24)]);
  }
  hoursEntries.sort();

  // Daily output tokens
  const dailyOut = new Map<string, number>();
  for (const r of src) {
    const day = r.startedAt.toISOString().slice(0, 10);
    dailyOut.set(day, (dailyOut.get(day) ?? 0) + Number(r.tokensOut));
  }
  const dailyOutEntries = [...dailyOut.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Intent mix
  const intent = new Map<string, number>();
  for (const r of src) {
    const k = r.intentTop ?? "other";
    intent.set(k, (intent.get(k) ?? 0) + 1);
  }

  // Tools used
  const tools = new Map<string, number>();
  for (const r of src) {
    const h = asObj(r.toolHist);
    for (const [name, n] of Object.entries(h)) tools.set(name, (tools.get(name) ?? 0) + n);
  }
  const toolsEntries = [...tools.entries()].sort((a, b) => b[1] - a[1]);

  // Skills
  const skills = new Map<string, number>();
  for (const r of src) for (const s of asArr<string>(r.skillsUsed)) skills.set(s, (skills.get(s) ?? 0) + 1);
  const skillsEntries = [...skills.entries()].sort((a, b) => b[1] - a[1]);

  // MCPs
  const mcps = new Map<string, number>();
  for (const r of src) for (const s of asArr<string>(r.mcpsUsed)) mcps.set(s, (mcps.get(s) ?? 0) + 1);
  const mcpsEntries = [...mcps.entries()].sort((a, b) => b[1] - a[1]);

  // Models
  const models = new Map<string, number>();
  for (const r of src) {
    const k = (r.model ?? "unknown").replace("claude-", "");
    models.set(k, (models.get(k) ?? 0) + Number(r.tokensOut));
  }
  const modelsEntries = [...models.entries()].sort((a, b) => b[1] - a[1]);

  // Per-project
  const byRepo = new Map<string, { sessions: number; msgs: number; tokensOut: number; tokensCacheRead: number }>();
  for (const r of src) {
    const k = r.repo;
    const v = byRepo.get(k) ?? { sessions: 0, msgs: 0, tokensOut: 0, tokensCacheRead: 0 };
    v.sessions++;
    v.msgs += r.messages;
    v.tokensOut += Number(r.tokensOut);
    v.tokensCacheRead += Number(r.tokensCacheRead);
    byRepo.set(k, v);
  }
  const repos = [...byRepo.entries()].sort((a, b) => b[1].tokensOut - a[1].tokensOut);

  // Context switches per day
  const ctxByDay = new Map<string, Set<string>>();
  for (const r of src) {
    const day = r.startedAt.toISOString().slice(0, 10);
    if (!ctxByDay.has(day)) ctxByDay.set(day, new Set());
    ctxByDay.get(day)!.add(r.repo);
  }
  const ctxEntries = [...ctxByDay.entries()].map(([d, s]) => [d, s.size] as [string, number]).sort();

  // Session velocity (tokens/hour bucket)
  const velocity = new Map<string, number>();
  for (const r of src) {
    const dur = (r.endedAt.getTime() - r.startedAt.getTime()) / 3600000;
    if (dur < 0.1 || r.tokensOut < 1000) continue;
    const tph = Number(r.tokensOut) / dur;
    const k = tph < 2000 ? "<2K/h grinding" : tph < 10000 ? "2-10K/h steady" : tph < 30000 ? "10-30K/h flowing" : "30K+/h burst";
    velocity.set(k, (velocity.get(k) ?? 0) + 1);
  }

  // Work-type mix (from filesEdited extensions)
  const wt = new Map<string, number>();
  for (const r of src) {
    const files = asArr<string>(r.filesEdited);
    if (!files.length) continue;
    const each = Number(r.tokensOut) / files.length;
    for (const f of files) {
      const ext = (f.split(".").pop() ?? "").toLowerCase();
      const k =
        ext === "md" || ext === "mdx" ? "docs" :
        /\/test|\.test\.|\.spec\./i.test(f) ? "tests" :
        ["json","yaml","yml","toml","env"].includes(ext) ? "config" :
        ["css","scss","html"].includes(ext) ? "ui-styles" :
        ["ts","tsx","js","jsx"].includes(ext) ? "js/ts source" :
        ["py","go","rs","rb"].includes(ext) ? "backend source" :
        ["sql","prisma"].includes(ext) ? "schema/db" :
        "other";
      wt.set(k, (wt.get(k) ?? 0) + each);
    }
  }
  const wtEntries = [...wt.entries()].sort((a, b) => b[1] - a[1]);

  // ---------- Outcome mix ----------
  // shipped/in_review/in_progress would need PR linkage; we classify locally:
  // planned (skills present) / explored (read-heavy no edits) / debugged (bugfix + edits)
  // stuck (errors+short) / dormant (>=10k output, no files) / zombie (>4h, <2msgs/hr) / in_progress (has edits) / other
  const outcomeCounts = new Map<string, number>();
  const outcomeTokens = new Map<string, number>();
  const PLANNING_SKILLS = new Set(["superpowers:brainstorming", "superpowers:writing-plans", "superpowers:brainstorm", "design-presearch"]);
  for (const r of src) {
    if (r.messages < 2) continue;
    const durH = (r.endedAt.getTime() - r.startedAt.getTime()) / 3600000;
    const files = asArr<string>(r.filesEdited);
    const skills = asArr<string>(r.skillsUsed);
    const th = asObj(r.toolHist);
    const readTools = (th.Read ?? 0) + (th.Grep ?? 0) + (th.Glob ?? 0);
    const editTools = (th.Edit ?? 0) + (th.Write ?? 0);
    const totalTools = Object.values(th).reduce((a, b) => a + b, 0);
    const out = Number(r.tokensOut);
    let bucket = "other";
    if (durH > 4 && r.messages / Math.max(durH, 0.1) < 2) bucket = "zombie";
    else if (skills.some(s => PLANNING_SKILLS.has(s))) bucket = "planned";
    else if (r.messages > 5 && (r.errors / Math.max(r.messages, 1) > 0.3) && durH > 0.25) bucket = "stuck";
    else if (r.intentTop === "bugfix" && files.length > 0) bucket = "debugged";
    else if (totalTools > 0 && readTools / Math.max(totalTools, 1) > 0.6 && editTools === 0 && out > 2000) bucket = "explored";
    else if (files.length > 0) bucket = "in_progress";
    else if (out > 10000) bucket = "dormant";
    outcomeCounts.set(bucket, (outcomeCounts.get(bucket) ?? 0) + 1);
    outcomeTokens.set(bucket, (outcomeTokens.get(bucket) ?? 0) + out);
  }
  const OUTCOMES = ["shipped","in_review","in_progress","planned","explored","debugged","stuck","dormant","zombie","other"];
  const outcomeLabels = OUTCOMES.filter(k => (outcomeCounts.get(k) ?? 0) > 0);
  const wasteTokens = (outcomeTokens.get("dormant") ?? 0) + (outcomeTokens.get("zombie") ?? 0);
  const wastePct = totals.tokensOut > 0 ? (100 * wasteTokens) / totals.tokensOut : 0;

  // ---------- Thrash files ----------
  const fileSess = new Map<string, Set<number>>();    // path -> session indices
  const fileTokens = new Map<string, number>();
  const fileDates = new Map<string, Date[]>();
  src.forEach((r, idx) => {
    const files = asArr<string>(r.filesEdited);
    for (const f of files) {
      if (!fileSess.has(f)) { fileSess.set(f, new Set()); fileTokens.set(f, 0); fileDates.set(f, []); }
      fileSess.get(f)!.add(idx);
      fileTokens.set(f, (fileTokens.get(f) ?? 0) + Number(r.tokensOut) / Math.max(files.length, 1));
      fileDates.get(f)!.push(r.startedAt);
    }
  });
  const thrash: any[] = [];
  for (const [f, sessSet] of fileSess) {
    if (sessSet.size < 3) continue;
    const dates = fileDates.get(f)!.sort((a, b) => a.getTime() - b.getTime());
    const days = Math.round((dates.at(-1)!.getTime() - dates[0].getTime()) / 86400000);
    thrash.push({ file: f, sessions: sessSet.size, tokens: Math.round(fileTokens.get(f) ?? 0), days });
  }
  thrash.sort((a, b) => b.tokens - a.tokens);

  // ---------- Teacher moments + frustration + prompt length ----------
  const teacher = src.reduce((a, r) => a + (r.teacherMoments ?? 0), 0);
  const frustration = src.reduce((a, r) => a + (r.frustrationSpikes ?? 0), 0);
  const promptWordMedians = src.map(r => r.promptWordsMedian ?? 0).filter(x => x > 0);
  const promptWordP95s = src.map(r => r.promptWordsP95 ?? 0).filter(x => x > 0);
  const promptMedianAvg = promptWordMedians.length ? Math.round(promptWordMedians.reduce((a,b)=>a+b,0) / promptWordMedians.length) : 0;
  const promptP95Max = promptWordP95s.length ? Math.max(...promptWordP95s) : 0;

  return {
    meta: {
      ...totals,
      cacheHitPct: +cacheHitPct.toFixed(1),
      projects: byRepo.size,
      teacherMoments: teacher,
      frustrationSpikes: frustration,
      promptMedianAvg,
      promptP95Max,
      wasteTokens,
      wastePct: +wastePct.toFixed(1),
    },
    hours: {
      labels: hoursEntries.map(e => e[0]),
      values: hoursEntries.map(e => +e[1].toFixed(2)),
    },
    daily_tokens: {
      labels: dailyOutEntries.map(e => e[0]),
      values: dailyOutEntries.map(e => e[1]),
    },
    intent: {
      labels: [...intent.keys()],
      values: [...intent.values()],
    },
    tools: {
      labels: topN(toolsEntries, 12).map(e => e[0]),
      values: topN(toolsEntries, 12).map(e => e[1]),
    },
    skills: {
      labels: topN(skillsEntries, 10).map(e => e[0]),
      values: topN(skillsEntries, 10).map(e => e[1]),
    },
    mcp: {
      labels: topN(mcpsEntries, 10).map(e => e[0]),
      values: topN(mcpsEntries, 10).map(e => e[1]),
    },
    models: {
      labels: topN(modelsEntries, 6).map(e => e[0]),
      values: topN(modelsEntries, 6).map(e => e[1]),
    },
    repos: repos.slice(0, 15).map(([r, v]) => ({
      repo: r,
      sessions: v.sessions,
      msgs: v.msgs,
      tokensOut: v.tokensOut,
      tokensCacheRead: v.tokensCacheRead,
    })),
    ctx: {
      labels: ctxEntries.map(e => e[0]),
      values: ctxEntries.map(e => e[1]),
    },
    velocity: {
      labels: [...velocity.keys()],
      values: [...velocity.values()],
    },
    worktype: {
      labels: wtEntries.map(e => e[0]),
      values: wtEntries.map(e => Math.round(e[1])),
    },
    outcome: {
      labels: outcomeLabels,
      values: outcomeLabels.map(k => outcomeCounts.get(k) ?? 0),
      tokens: outcomeLabels.map(k => outcomeTokens.get(k) ?? 0),
    },
    thrash: thrash.slice(0, 15),
  };
}

export function aggregateBoth(rows: Row[]) {
  return {
    claude: aggregate(rows, "claude"),
    codex: aggregate(rows, "codex"),
  };
}
