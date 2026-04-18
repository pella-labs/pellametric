import type { CardData } from "./card-utils";

/** Build 160 days of plausible activity ending on 2026-04-17. */
function buildDailyDistribution() {
  const endDate = new Date("2026-04-17T00:00:00Z");
  const rows: NonNullable<CardData["stats"]["combined"]["dailyDistribution"]> = [];
  // Deterministic pseudo-random from a per-day seed.
  const seeded = (n: number) => {
    const x = Math.sin(n * 9301 + 49297) * 0.5 + 0.5;
    return x - Math.floor(x);
  };
  const DAYS = 160;
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setUTCDate(endDate.getUTCDate() - i);
    const dow = d.getUTCDay(); // 0=Sun .. 6=Sat
    const weekend = dow === 0 || dow === 6;
    const rand = seeded(i + 1);
    // Rare rest day (~3%); weekends lighter but active; weekdays heavy.
    const restDay = rand < 0.03;
    const base = restDay ? 0 : weekend ? 6 + rand * 14 : 18 + rand * 26;
    const claudeShare = 0.7 + seeded(i + 100) * 0.2; // 70–90% Claude
    const claudeSessions = Math.round(base * claudeShare);
    const codexSessions = Math.round(base - claudeSessions);
    const sessions = claudeSessions + codexSessions;
    // Cost roughly $0.35–$0.55 per session for Claude, $0.25 for Codex.
    const cost =
      Number(
        (
          claudeSessions * (0.38 + seeded(i + 200) * 0.18) +
          codexSessions * (0.22 + seeded(i + 300) * 0.1)
        ).toFixed(2),
      ) || 0;
    rows.push({
      date: d.toISOString().slice(0, 10),
      sessions,
      cost,
      claudeSessions,
      codexSessions,
    });
  }
  return rows;
}

/** Curated demo data used in the hero card + /demo preview. */
export const DEMO_CARD: CardData = {
  cardId: "demo",
  stats: {
    claude: {
      sessions: 847,
      cost: 412.83,
      inputTokens: 18_420_000,
      outputTokens: 3_610_000,
      cacheReadTokens: 92_100_000,
      cacheCreateTokens: 14_800_000,
      cacheSavingsUsd: 312.4,
      models: {
        "claude-opus-4-6": { sessions: 312, cost: 238.9 },
        "claude-sonnet-4-6": { sessions: 498, cost: 168.2 },
        "claude-haiku-4-5": { sessions: 37, cost: 5.73 },
      },
      topTools: [
        { name: "Edit", count: 4820 },
        { name: "Read", count: 3910 },
        { name: "Bash", count: 2640 },
        { name: "Grep", count: 1380 },
        { name: "Write", count: 960 },
        { name: "Glob", count: 740 },
        { name: "Skill", count: 220 },
        { name: "WebSearch", count: 95 },
      ],
      totalToolCalls: 14_765,
      hourDistribution: [
        2, 1, 0, 0, 0, 0, 1, 3, 6, 14, 28, 41, 58, 72, 81, 92, 76, 64, 52, 38, 29, 21, 14, 7,
      ],
      activeDays: 42,
      projects: [
        { name: "bematist", sessions: 382, cost: 198.4 },
        { name: "analytics-service", sessions: 206, cost: 104.5 },
        { name: "collector", sessions: 128, cost: 68.1 },
        { name: "dashboard", sessions: 89, cost: 32.2 },
        { name: "infra", sessions: 42, cost: 9.6 },
      ],
    },
    codex: {
      sessions: 184,
      cost: 48.7,
      inputTokens: 4_120_000,
      cachedInputTokens: 1_840_000,
      outputTokens: 920_000,
      models: {
        "gpt-5.3-codex": { sessions: 128, cost: 38.4 },
        "gpt-5.2-codex": { sessions: 56, cost: 10.3 },
      },
      activeDays: 19,
      projects: [
        { name: "bematist", sessions: 92, cost: 27.8 },
        { name: "collector", sessions: 54, cost: 14.1 },
        { name: "infra", sessions: 38, cost: 6.8 },
      ],
      topTools: [
        { name: "apply_patch", count: 612 },
        { name: "exec_command", count: 348 },
        { name: "read_file", count: 210 },
      ],
      totalToolCalls: 1_170,
      totalReasoningBlocks: 4_218,
      totalWebSearches: 31,
    },
    combined: {
      totalCost: 461.53,
      totalSessions: 1_031,
      totalInputTokens: 22_540_000,
      totalOutputTokens: 4_530_000,
      totalActiveDays: 47,
      dailyDistribution: buildDailyDistribution(),
    },
    highlights: {
      favoriteModel: "claude-sonnet-4-6",
      favoriteTool: "Edit",
      peakHour: 15,
      peakHourLabel: "3 PM",
      personality: "The Daylight Builder",
      totalToolCalls: 15_935,
      cacheHitRate: 0.82,
      longestStreak: 18,
      mostExpensiveSession: {
        cost: 14.8,
        model: "claude-opus-4-6",
        project: "bematist",
        date: "2026-04-02",
      },
      avgCostPerSession: 0.45,
      avgSessionsPerDay: 21.9,
      mcpServers: [],
      totalMcpCalls: 0,
      skillInvocations: 220,
      builtinTools: [],
      readWriteRatio: { reads: 3910, writes: 960, ratio: "4.07" },
      costWithoutCache: 774.2,
      activityCategories: [
        {
          category: "Building",
          description: "New features, modules, and surfaces",
          sessions: 412,
          sessionPct: 40,
          cost: 198.6,
          costPct: 43,
        },
        {
          category: "Investigating",
          description: "Reading and tracing existing code",
          sessions: 258,
          sessionPct: 25,
          cost: 98.4,
          costPct: 21,
        },
        {
          category: "Debugging",
          description: "Fixing bugs, reproducing issues",
          sessions: 186,
          sessionPct: 18,
          cost: 84.2,
          costPct: 18,
        },
        {
          category: "Testing",
          description: "Writing and running tests",
          sessions: 92,
          sessionPct: 9,
          cost: 41.8,
          costPct: 9,
        },
        {
          category: "Refactoring",
          description: "Restructuring without changing behavior",
          sessions: 58,
          sessionPct: 6,
          cost: 28.3,
          costPct: 6,
        },
        {
          category: "Other",
          description: "Everything else",
          sessions: 25,
          sessionPct: 2,
          cost: 10.2,
          costPct: 3,
        },
      ],
    },
  },
  user: {
    displayName: "Demo Developer",
    photoURL: "",
    githubUsername: "demo-dev",
  },
  createdAt: "2026-04-17T00:00:00.000Z",
};
