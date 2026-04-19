function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Types matching what GET /api/card/:id returns
export interface ProjectEntry {
  name: string;
  sessions: number;
  cost: number;
}

export interface Highlights {
  favoriteModel: string;
  favoriteTool: string;
  peakHour: number;
  peakHourLabel: string;
  personality: string;
  totalToolCalls: number;
  cacheHitRate: number;
  longestStreak: number;
  mostExpensiveSession: {
    cost: number;
    model: string;
    project: string;
    date: string;
  };
  avgCostPerSession: number;
  avgSessionsPerDay: number;
  mcpServers: Array<{
    name: string;
    totalCalls: number;
    tools: Array<{ name: string; count: number }>;
  }>;
  totalMcpCalls: number;
  skillInvocations: number;
  builtinTools: Array<{ name: string; count: number }>;
  readWriteRatio: { reads: number; writes: number; ratio: string };
  costWithoutCache: number;
  activityCategories?: Array<{
    category: string;
    description: string;
    sessions: number;
    sessionPct: number;
    cost: number;
    costPct: number;
  }>;
}

export interface CardData {
  cardId: string;
  stats: {
    claude: {
      sessions: number;
      cost: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreateTokens: number;
      cacheSavingsUsd: number;
      models: Record<string, { sessions: number; cost: number }>;
      topTools: Array<{ name: string; count: number }>;
      totalToolCalls?: number;
      hourDistribution: number[];
      activeDays: number;
      projects?: ProjectEntry[];
    };
    codex: {
      sessions: number;
      cost: number;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      models: Record<string, { sessions: number; cost: number }>;
      activeDays?: number;
      projects?: ProjectEntry[];
      topTools?: Array<{ name: string; count: number }>;
      totalToolCalls?: number;
      totalReasoningBlocks?: number;
      totalWebSearches?: number;
    };
    combined: {
      totalCost: number;
      totalSessions: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalActiveDays?: number;
      dailyDistribution?: Array<{
        date: string;
        sessions: number;
        cost: number;
        claudeSessions: number;
        codexSessions: number;
      }>;
    };
    highlights?: Highlights;
  };
  user: {
    displayName: string;
    photoURL: string;
    githubUsername: string;
  } | null;
  createdAt: string;
}

export function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export function formatCost(n: number): string {
  if (n >= 100) return `$${Math.round(n)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function getTotalTokens(stats: CardData["stats"]): number {
  return stats.combined.totalInputTokens + stats.combined.totalOutputTokens;
}

export function getPeakHour(hourDist: number[]): string {
  const maxIdx = hourDist.indexOf(Math.max(...hourDist));
  const h = maxIdx % 12 || 12;
  const ampm = maxIdx < 12 ? "AM" : "PM";
  return `${h} ${ampm}`;
}

export function getTotalToolCalls(topTools: Array<{ name: string; count: number }>): number {
  return topTools.reduce((sum, t) => sum + t.count, 0);
}

export function getAvgCost(stats: CardData["stats"]): string {
  const avg = stats.combined.totalCost / stats.combined.totalSessions;
  return formatCost(avg);
}

export function getTier(totalSessions: number): string {
  if (totalSessions >= 5000) return "Max User";
  if (totalSessions >= 1000) return "Power User";
  if (totalSessions >= 100) return "Active User";
  return "New User";
}

export function getLevel(totalSessions: number): { level: number; title: string; pct: number } {
  if (totalSessions >= 5000) return { level: 7, title: "Architect", pct: 90 };
  if (totalSessions >= 2000) return { level: 6, title: "Principal", pct: 75 };
  if (totalSessions >= 1000) return { level: 5, title: "Senior", pct: 60 };
  if (totalSessions >= 500) return { level: 4, title: "Mid-Level", pct: 45 };
  if (totalSessions >= 100) return { level: 3, title: "Junior", pct: 30 };
  if (totalSessions >= 10) return { level: 2, title: "Beginner", pct: 15 };
  return { level: 1, title: "Newbie", pct: 5 };
}

// Map CLI personality names to better display names
const personalityMap: Record<string, { name: string; desc: string }> = {
  "9-to-5er / Power User": {
    name: "The Daylight Builder",
    desc: "You ship during working hours with relentless consistency.",
  },
  "9-to-5er": {
    name: "The Daylight Builder",
    desc: "You ship during working hours with relentless consistency.",
  },
  "Night Owl / Power User": {
    name: "The Midnight Architect",
    desc: "You do your best work when the world goes quiet.",
  },
  "Night Owl": {
    name: "The Midnight Architect",
    desc: "You do your best work when the world goes quiet.",
  },
  "Weekend Warrior": {
    name: "The Weekend Warrior",
    desc: "Saturdays and Sundays are your secret weapon.",
  },
  "Early Bird": {
    name: "The Dawn Shipper",
    desc: "First commit before the sun rises. Unstoppable.",
  },
  Grinder: { name: "The Relentless", desc: "No breaks, no limits you code around the clock." },
};

export function mapPersonality(raw: string): { name: string; desc: string } {
  const mapped = personalityMap[raw];
  if (mapped) return mapped;
  // If it has a slash, take just the first part and make it nicer
  const clean = (raw.split("/")[0] ?? raw).trim();
  return { name: clean, desc: "" };
}

export function getPersonality(hourDist: number[]): { name: string; desc: string } {
  const night =
    hourDist.slice(21, 24).reduce((a, b) => a + b, 0) +
    hourDist.slice(0, 5).reduce((a, b) => a + b, 0);
  const morning = hourDist.slice(5, 12).reduce((a, b) => a + b, 0);
  const afternoon = hourDist.slice(12, 17).reduce((a, b) => a + b, 0);
  const evening = hourDist.slice(17, 21).reduce((a, b) => a + b, 0);
  const total = night + morning + afternoon + evening;

  if (!total) return { name: "Explorer", desc: "Just getting started on your coding journey." };

  const nightPct = night / total;
  const morningPct = morning / total;

  if (nightPct > 0.4)
    return { name: "The Midnight Architect", desc: "You build when the world goes quiet." };
  if (morningPct > 0.4)
    return { name: "The Dawn Shipper", desc: "First commit before the sun rises." };
  if (afternoon / total > 0.4)
    return { name: "The Daylight Builder", desc: "Peak focus during working hours." };
  if (evening / total > 0.4)
    return { name: "The Twilight Coder", desc: "You hit your stride as the day winds down." };
  return { name: "The Relentless", desc: "Consistent output across the day no off switch." };
}

export function getCodexPersonality(stats: CardData["stats"]): { name: string; desc: string } {
  const s = stats.codex;
  const tools = s.topTools ?? [];
  const totalCalls = s.totalToolCalls ?? 0;
  const reasoning = s.totalReasoningBlocks ?? 0;
  const searches = s.totalWebSearches ?? 0;
  const sessions = s.sessions;
  const modelCount = Object.keys(s.models).length;

  if (!sessions) return { name: "Explorer", desc: "Just getting started with Codex." };

  // Compute dominant tool
  const execCalls = tools
    .filter((t) => ["exec_command", "shell_command", "shell", "write_stdin"].includes(t.name))
    .reduce((s, t) => s + t.count, 0);
  const editCalls = tools.filter((t) => t.name === "apply_patch").reduce((s, t) => s + t.count, 0);
  const execRatio = totalCalls > 0 ? execCalls / totalCalls : 0;
  const editRatio = totalCalls > 0 ? editCalls / totalCalls : 0;
  const reasoningRatio = sessions > 0 ? reasoning / sessions : 0;

  if (searches > 200)
    return {
      name: "Research Engineer",
      desc: `${searches} web searches you let Codex explore before building.`,
    };
  if (reasoningRatio > 150)
    return {
      name: "Deep Reasoner",
      desc: `${reasoning.toLocaleString()} reasoning blocks Codex thinks hard for you.`,
    };
  if (execRatio > 0.7)
    return {
      name: "Shell Commander",
      desc: `${execCalls.toLocaleString()} exec calls you live in the terminal.`,
    };
  if (editRatio > 0.3)
    return {
      name: "Patch Artist",
      desc: `${editCalls.toLocaleString()} patches applied surgical code changes.`,
    };
  if (sessions >= 100)
    return {
      name: "Codex Veteran",
      desc: `${sessions} sessions across ${modelCount} models a power user.`,
    };
  return { name: "Codex Builder", desc: `${sessions} sessions across ${modelCount} models.` };
}

export function getCacheSaved(stats: CardData["stats"]): string {
  const saved = stats.claude.cacheSavingsUsd;
  if (saved >= 1000) return `$${(saved / 1000).toFixed(1)}K`;
  if (saved >= 1) return `$${Math.round(saved)}`;
  return "$0";
}

export function getModelColors(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("opus")) return "#b07b3e";
  if (m.includes("sonnet")) return "#8fb078";
  if (m.includes("haiku")) return "#6e8a6f";
  if (m.includes("gpt") || m.includes("codex")) return "#d4a771";
  if (m.includes("o3") || m.includes("o4")) return "#c9a66a";
  return "#9ca59a";
}

export function getToolColor(idx: number): string {
  const colors = [
    "#6e8a6f",
    "#b07b3e",
    "#8fb078",
    "#d4a771",
    "#52715a",
    "#a59480",
    "#c9a66a",
    "#b8d8a1",
  ];
  return colors[idx % colors.length] ?? colors[0] ?? "#52715a";
}

// Normalize hourDistribution to 0-1 range for bar heights
export function normalizeHours(hourDist: number[]): number[] {
  const max = Math.max(...hourDist, 1);
  return hourDist.map((v) => v / max);
}

// Get color for hour bar based on intensity
export function getHourBarColor(intensity: number): string {
  if (intensity > 0.7) return "#b8d8a1";
  if (intensity > 0.4) return "#8fb078";
  if (intensity > 0.15) return "rgba(110,138,111,.55)";
  return "rgba(110,138,111,.18)";
}

export type AchievementIcon = "flame" | "wrench" | "rocket" | "monitor";

export function getAchievements(
  stats: CardData["stats"],
  view: "combined" | "claude" | "codex" = "combined",
): Array<{ name: string; desc: string; color: string; icon: AchievementIcon }> {
  const achievements: Array<{ name: string; desc: string; color: string; icon: AchievementIcon }> =
    [];

  const sessions =
    view === "claude"
      ? stats.claude.sessions
      : view === "codex"
        ? stats.codex.sessions
        : stats.combined.totalSessions;
  const activeDays =
    view === "codex"
      ? (stats.codex.activeDays ?? 0)
      : view === "claude"
        ? stats.claude.activeDays
        : (stats.combined.totalActiveDays ?? stats.claude.activeDays);
  const toolCalls =
    view === "codex"
      ? (stats.codex.totalToolCalls ?? 0)
      : view === "claude"
        ? getTotalToolCalls(stats.claude.topTools)
        : getTotalToolCalls(stats.claude.topTools) + (stats.codex.totalToolCalls ?? 0);
  const models =
    view === "codex"
      ? stats.codex.models
      : view === "claude"
        ? stats.claude.models
        : { ...stats.claude.models, ...stats.codex.models };

  if (activeDays >= 30)
    achievements.push({
      name: "Marathon",
      desc: `${activeDays}-day streak`,
      color: "#b07b3e",
      icon: "flame",
    });
  if (toolCalls >= 50000)
    achievements.push({
      name: "Power User",
      desc: "50K+ tool calls",
      color: "#b07b3e",
      icon: "wrench",
    });
  else if (toolCalls >= 10000)
    achievements.push({
      name: "Tool Master",
      desc: "10K+ tool calls",
      color: "#b07b3e",
      icon: "wrench",
    });
  if (sessions >= 5000)
    achievements.push({ name: "Ship It", desc: "5K+ sessions", color: "#6e8a6f", icon: "rocket" });
  else if (sessions >= 1000)
    achievements.push({ name: "Prolific", desc: "1K+ sessions", color: "#6e8a6f", icon: "rocket" });

  // Codex-specific achievements
  if (view === "codex" || view === "combined") {
    if ((stats.codex.totalReasoningBlocks ?? 0) >= 5000)
      achievements.push({
        name: "Deep Thinker",
        desc: "5K+ reasoning blocks",
        color: "#d4a771",
        icon: "monitor",
      });
    if ((stats.codex.totalWebSearches ?? 0) >= 100)
      achievements.push({
        name: "Researcher",
        desc: "100+ web searches",
        color: "#8fb078",
        icon: "monitor",
      });
  }

  // Check for model loyalty
  const totalModelSessions = Object.values(models).reduce((s, m) => s + m.sessions, 0);
  for (const [name, data] of Object.entries(models)) {
    if (totalModelSessions > 0 && data.sessions / totalModelSessions > 0.9) {
      const shortName = name.includes("opus")
        ? "Opus"
        : name.includes("sonnet")
          ? "Sonnet"
          : name.includes("haiku")
            ? "Haiku"
            : name.includes("codex")
              ? "Codex"
              : name;
      achievements.push({
        name: `${shortName} Loyalist`,
        desc: "90%+ on one model",
        color: "#8fb078",
        icon: "monitor",
      });
      break;
    }
  }

  return achievements.slice(0, 4);
}

export function getFunFacts(
  stats: CardData["stats"],
  view: "combined" | "claude" | "codex" = "combined",
): Array<{ text: string; color: string }> {
  const facts: Array<{ text: string; color: string }> = [];

  const tokens =
    view === "claude"
      ? stats.claude.inputTokens + stats.claude.outputTokens
      : view === "codex"
        ? stats.codex.inputTokens + stats.codex.outputTokens
        : getTotalTokens(stats);
  const cost =
    view === "claude"
      ? stats.claude.cost
      : view === "codex"
        ? stats.codex.cost
        : stats.combined.totalCost;
  const models =
    view === "codex"
      ? stats.codex.models
      : view === "claude"
        ? stats.claude.models
        : { ...stats.claude.models };

  // Tokens as novels
  const novels = Math.round(tokens / 1_000_000);
  if (novels > 0) {
    facts.push({
      text: `Your <strong>${formatTokens(tokens)} tokens</strong> equal roughly <span class="highlight">${novels} full-length novels</span> worth of generated code`,
      color: "#b07b3e",
    });
  }

  // Cost efficiency
  if (cost > 0) {
    const tokensPerDollar = tokens / cost;
    facts.push({
      text: `Your cost efficiency: <span class="blue-hl">${formatTokens(tokensPerDollar)} tokens per dollar</span>`,
      color: "#8fb078",
    });
  }

  // Top model usage
  const topModel = Object.entries(models).sort((a, b) => b[1].sessions - a[1].sessions)[0];
  if (topModel) {
    const totalModelSessions = Object.values(models).reduce((s, m) => s + m.sessions, 0);
    const pct = Math.round((topModel[1].sessions / totalModelSessions) * 100);
    const shortName = topModel[0].includes("opus")
      ? "Opus"
      : topModel[0].includes("sonnet")
        ? "Sonnet"
        : topModel[0].includes("haiku")
          ? "Haiku"
          : topModel[0].includes("codex")
            ? "Codex"
            : topModel[0].includes("gpt")
              ? "GPT"
              : escapeHtml(topModel[0]);
    facts.push({
      text: `${escapeHtml(shortName)} handled <span class="highlight">${pct}%</span> of your turns`,
      color: "#d4a771",
    });
  }

  // Codex-specific: reasoning blocks
  if (view === "codex" && (stats.codex.totalReasoningBlocks ?? 0) > 0) {
    facts.push({
      text: `Codex used <span class="highlight">${(stats.codex.totalReasoningBlocks ?? 0).toLocaleString()} reasoning blocks</span> to think through your code`,
      color: "#d4a771",
    });
  }

  // Cache savings
  if (view !== "codex" && stats.claude.cacheSavingsUsd > 1) {
    facts.push({
      text: `Cache saved you <span class="green-hl">${formatCost(stats.claude.cacheSavingsUsd)}</span> in token costs`,
      color: "#6e8a6f",
    });
  } else if (view === "codex" && stats.codex.cachedInputTokens > 0) {
    facts.push({
      text: `<span class="green-hl">${formatTokens(stats.codex.cachedInputTokens)}</span> tokens served from cache`,
      color: "#6e8a6f",
    });
  }

  return facts.slice(0, 3);
}

export function getModelDistribution(
  stats: CardData["stats"],
): Array<{ name: string; pct: number; color: string }> {
  const models: Record<string, { sessions: number; cost: number }> = { ...stats.claude.models };
  // Merge codex models
  for (const [name, data] of Object.entries(stats.codex.models)) {
    if (models[name]) {
      models[name] = {
        sessions: models[name].sessions + data.sessions,
        cost: models[name].cost + data.cost,
      };
    } else {
      models[name] = data;
    }
  }

  const total = Object.values(models).reduce((s, m) => s + m.sessions, 0);
  if (!total) return [];

  return Object.entries(models)
    .map(([name, data]) => {
      let shortName = name;
      if (name.includes("opus")) shortName = "Opus 4";
      else if (name.includes("sonnet")) shortName = "Sonnet 4";
      else if (name.includes("haiku")) shortName = "Haiku 3.5";
      else if (name.includes("codex")) shortName = name.replace(/gpt-/g, "GPT ");
      return {
        name: shortName,
        pct: Math.round((data.sessions / total) * 1000) / 10,
        color: getModelColors(name),
      };
    })
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 4);
}
