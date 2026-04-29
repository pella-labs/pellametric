/** biome-ignore-all lint/a11y/noSvgWithoutTitle: decorative marketing icons; adjacent text carries meaning */

import type React from "react";
import {
  type AchievementIcon,
  type CardData,
  type Highlights,
  formatCost,
  formatTokens,
  getHourBarColor,
  getModelColors,
} from "./card-utils";
import { AchievementSvg, FlameIcon } from "./icons";

type Personality = { name: string; desc: string };
type Achievement = { name: string; desc: string; color: string; icon: AchievementIcon };

export const TOTAL_PAGES = 8;

// ── Small helpers colocated with the slides that use them ──

function shortModelName(name: string): string {
  // Claude
  if (name.includes("opus-4-7")) return "Opus 4.7";
  if (name.includes("opus-4-6")) return "Opus 4.6";
  if (name.includes("opus-4-5")) return "Opus 4.5";
  if (name.includes("opus-4")) return "Opus 4";
  if (name.includes("3-opus") || name.includes("claude-3-opus")) return "Opus 3";
  if (name.includes("opus")) return "Opus";
  if (name.includes("sonnet-4-7")) return "Sonnet 4.7";
  if (name.includes("sonnet-4-6")) return "Sonnet 4.6";
  if (name.includes("sonnet-4-5")) return "Sonnet 4.5";
  if (name.includes("sonnet-4")) return "Sonnet 4";
  if (name.includes("3-5-sonnet") || name.includes("3.5-sonnet")) return "Sonnet 3.5";
  if (name.includes("sonnet")) return "Sonnet";
  if (name.includes("haiku-4-5")) return "Haiku 4.5";
  if (name.includes("haiku-4")) return "Haiku 4";
  if (name.includes("haiku")) return "Haiku 3.5";
  // OpenAI / Codex — longest-match first (spark/mini must come before generic codex)
  if (name.includes("codex-spark")) return "Codex Spark";
  if (name.includes("codex-mini")) return "Codex Mini";
  if (name.includes("gpt-5.3-codex")) return "Codex 5.3";
  if (name.includes("gpt-5.2-codex")) return "Codex 5.2";
  if (name.includes("gpt-5.1-codex")) return "Codex 5.1";
  if (name.includes("gpt-5.4")) return "GPT-5.4";
  if (name.includes("gpt-5")) return "GPT-5";
  if (name.includes("gpt-4o-mini")) return "GPT-4o mini";
  if (name.includes("gpt-4o")) return "GPT-4o";
  if (name.includes("gpt-4")) return "GPT-4";
  if (name.startsWith("o3-mini")) return "o3-mini";
  if (name.startsWith("o3")) return "o3";
  if (name.startsWith("o4-mini")) return "o4-mini";
  // Google
  if (name.includes("gemini-1.5-pro")) return "Gemini 1.5 Pro";
  if (name.includes("gemini-pro")) return "Gemini Pro";
  // Cursor's own
  if (name.includes("cursor-small")) return "Cursor Small";
  if (name.includes("cursor-fast")) return "Cursor Fast";
  if (name === "unknown") return "Unknown";
  return name;
}

const toolDisplayNames: Record<string, { name: string; desc: string }> = {
  // Claude Code tools
  Bash: { name: "Bash", desc: "Terminal commands" },
  Read: { name: "Read", desc: "Reading files" },
  Edit: { name: "Edit", desc: "Editing code" },
  Write: { name: "Write", desc: "Creating files" },
  Grep: { name: "Grep", desc: "Searching code" },
  Glob: { name: "Glob", desc: "Finding files" },
  Agent: { name: "Agent", desc: "Sub-agents" },
  WebSearch: { name: "Web Search", desc: "Searching the web" },
  WebFetch: { name: "Web Fetch", desc: "Fetching URLs" },
  Skill: { name: "Skill", desc: "Skill invocations" },
  TodoWrite: { name: "Todo", desc: "Task tracking" },
  TaskCreate: { name: "Tasks", desc: "Creating tasks" },
  TaskUpdate: { name: "Tasks", desc: "Updating tasks" },
  ToolSearch: { name: "Tool Search", desc: "Finding tools" },
  // Codex tools
  exec_command: { name: "Run Command", desc: "Terminal execution" },
  apply_patch: { name: "Apply Patch", desc: "Code changes" },
  write_stdin: { name: "Write Input", desc: "Interactive input" },
  shell_command: { name: "Shell", desc: "Shell commands" },
  shell: { name: "Shell", desc: "Shell execution" },
  read_file: { name: "Read File", desc: "Reading files" },
  write_file: { name: "Write File", desc: "Creating files" },
  list_directory: { name: "List Dir", desc: "Browsing folders" },
  search_files: { name: "Search", desc: "Searching code" },
  web_search: { name: "Web Search", desc: "Searching the web" },
};

function getToolDisplay(rawName: string): { name: string; desc: string } {
  // Check exact match
  const exact = toolDisplayNames[rawName];
  if (exact) return exact;
  // Check MCP tools: mcp__ServerName__tool_name
  const mcpMatch = rawName.match(/^mcp__([^_]+)__(.+)$/);
  if (mcpMatch?.[1] && mcpMatch[2]) {
    const tool = mcpMatch[2].replace(/_/g, " ");
    return {
      name: tool.charAt(0).toUpperCase() + tool.slice(1),
      desc: `${mcpMatch[1]} MCP`,
    };
  }
  // Fallback: clean up snake_case/camelCase
  const cleaned = rawName.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return { name: cleaned.charAt(0).toUpperCase() + cleaned.slice(1), desc: "" };
}

function cleanProjectName(name: string): string {
  const parts = name.split("-").filter(Boolean);
  return parts[parts.length - 1] || name;
}

function getDailyColor(
  intensity: number,
  _hasClaude: boolean,
  _hasCodex: boolean,
  isCream = false,
): string {
  if (intensity === 0) return isCream ? "rgba(0,0,0,.03)" : "rgba(255,255,255,.02)";
  if (intensity > 0.75) return "#b8d8a1";
  if (intensity > 0.5) return "#8fb078";
  if (intensity > 0.25) return "#6e8a6f";
  if (intensity > 0.1) return "#52715a";
  return "#3a5a45";
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="sec-head">
      <div className="sec-title">{title}</div>
      {sub && <div className="sec-sub">{sub}</div>}
    </div>
  );
}

// ── SlideProps: every value the switch-cased JSX reads from the page
// scope. Collecting them in one object keeps the dispatch call site
// tidy and makes it obvious at a glance what the slides depend on. ──

type DailyDist = NonNullable<CardData["stats"]["combined"]["dailyDistribution"]>;
type ProjectRow = { name: string; sessions: number; cost: number; source: string };
type ModelRow = { name: string; cost: number; sessions: number };

export type StatView = "combined" | "claude" | "codex";
export type CardTheme = "cream" | "dark";

export type SlideProps = {
  data: CardData;
  show: boolean;
  statView: StatView;
  cardTheme: CardTheme;
  // Slide 0
  tier: string;
  userName: string;
  viewTokens: number;
  viewStreak: number;
  lvl: { level: number; title: string; pct: number };
  dailyDist: DailyDist;
  viewActiveDays: number;
  // Slide 1
  personality: Personality;
  viewCost: number;
  achievements: Achievement[];
  // Slide 2
  hourBars: number[];
  viewCacheSaved: string;
  activityCategories: NonNullable<Highlights["activityCategories"]>;
  actCatColors: string[];
  // Slide 3
  topTools: { name: string; count: number }[];
  // Slide 4
  viewModels: ModelRow[];
  // Slide 5 + 6
  viewProjects: ProjectRow[];
  // Slide 6
  projectMapSize: number;
  // Slide 7
  mostExpensive: Highlights["mostExpensiveSession"] | null;
};

// ── Per-slide render functions ──

function renderIdentitySlide(p: SlideProps): React.ReactElement {
  const { data, show, tier, userName, viewTokens, viewStreak, lvl, dailyDist, statView, cardTheme, viewActiveDays } = p;
  return (
    <div className="card-content">
      <div className={`top-row reveal ${show ? "show" : ""}`}>
        <div className="brand">PELLAMETRIC</div>
        <div className="tier">{tier}</div>
      </div>
      <div className={`reveal ${show ? "show" : ""}`} style={{ transitionDelay: "130ms" }}>
        <div className="user-name">{userName}</div>
        <div className="user-sub">
          {data.user?.githubUsername ? `@${data.user.githubUsername}` : ""}
        </div>
      </div>
      <div className={`hero reveal ${show ? "show" : ""}`} style={{ transitionDelay: "260ms" }}>
        <div className="hero-label">Tokens Generated</div>
        <div className="hero-num">
          <span>{formatTokens(viewTokens)}</span>
          <span className="hero-unit">tokens</span>
        </div>
      </div>
      <div className={`reveal ${show ? "show" : ""}`} style={{ transitionDelay: "390ms" }}>
        <div className="streak-level">
          <div className="streak">
            <FlameIcon /> {viewStreak} day streak
          </div>
          <div className="sep" />
          <div className="lvl-t">
            Lvl {lvl.level} {"·"} {lvl.title}
          </div>
        </div>
        <div className="lvl-track">
          <div
            className={`lvl-fill ${show ? "go" : ""}`}
            style={{ "--lvl-pct": `${lvl.pct}%` } as React.CSSProperties}
          />
        </div>
      </div>
      {/* GitHub contribution graph */}
      <div className={`reveal ${show ? "show" : ""}`} style={{ transitionDelay: "520ms", marginTop: "auto" }}>
        <div className="gh-heatmap">
          {(() => {
            // Always render a fixed 7 × 22 grid (last ~22 weeks), regardless of how sparse the data is.
            const WEEKS = 22;
            const endDate = new Date();
            endDate.setHours(12, 0, 0, 0);
            // Grid ends on Saturday of current week; walk back to find the Sunday that starts the 22nd-prev week.
            const gridEnd = new Date(endDate);
            gridEnd.setDate(endDate.getDate() + (6 - endDate.getDay()));
            const gridStart = new Date(gridEnd);
            gridStart.setDate(gridEnd.getDate() - (WEEKS * 7 - 1));
            const rangeStartKey = gridStart.toISOString().split("T")[0] ?? "";
            const rangeEndKey = endDate.toISOString().split("T")[0] ?? "";
            const dayMap = new Map(dailyDist.map((d) => [d.date, d]));
            const cells: Array<{
              date: string;
              sessions: number;
              claude: number;
              codex: number;
              inRange: boolean;
            }> = [];
            const cursor = new Date(gridStart);
            for (let i = 0; i < WEEKS * 7; i++) {
              const key = cursor.toISOString().split("T")[0] ?? "";
              const d = dayMap.get(key);
              const ss = d
                ? statView === "claude"
                  ? d.claudeSessions
                  : statView === "codex"
                    ? d.codexSessions
                    : d.sessions
                : 0;
              cells.push({
                date: key,
                sessions: ss,
                claude: d?.claudeSessions ?? 0,
                codex: d?.codexSessions ?? 0,
                inRange: key >= rangeStartKey && key <= rangeEndKey,
              });
              cursor.setDate(cursor.getDate() + 1);
            }
            const maxS = Math.max(...cells.map((c) => c.sessions), 1);
            return (
              <div className="gh-grid-wrap">
                <div className="gh-day-labels">
                  {["", "M", "", "W", "", "F", ""].map((l, i) => (
                    <span key={i}>{l}</span>
                  ))}
                </div>
                <div className="gh-grid" style={{ gridTemplateColumns: `repeat(${WEEKS}, 1fr)` }}>
                  {Array.from({ length: WEEKS }, (_, col) =>
                    Array.from({ length: 7 }, (_, row) => {
                      const cell = cells[col * 7 + row];
                      if (!cell) return null;
                      const intensity = cell.sessions / maxS;
                      const hasClaude = statView !== "codex" && cell.claude > 0;
                      const hasCodex = statView !== "claude" && cell.codex > 0;
                      const label = new Date(`${cell.date}T12:00:00`).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      });
                      return (
                        <div
                          key={`${col}-${row}`}
                          className="gh-cell"
                          title={cell.inRange ? `${label}: ${cell.sessions} sessions` : ""}
                          style={{
                            background:
                              cell.sessions === 0
                                ? undefined
                                : getDailyColor(intensity, hasClaude, hasCodex, cardTheme === "cream"),
                            gridRow: row + 1,
                            gridColumn: col + 1,
                          }}
                        />
                      );
                    }),
                  )}
                </div>
              </div>
            );
          })()}
        </div>
        <div className="gh-legend">
          <span>{viewActiveDays} active days</span>
        </div>
      </div>
    </div>
  );
}

function renderPersonalitySlide(p: SlideProps): React.ReactElement {
  const { personality, viewTokens, viewCost, viewActiveDays, achievements } = p;
  return (
    <div className="card-content">
      <div className="top-row">
        <div className="brand">PELLAMETRIC</div>
        <div className="page-title">Identity</div>
      </div>
      <div className="wrap-insight">
        <div className="wrap-emoji">
          {personality.name.includes("Midnight")
            ? "\u{1F319}"
            : personality.name.includes("Dawn")
              ? "\u{1F305}"
              : personality.name.includes("Twilight")
                ? "\u{1F307}"
                : personality.name.includes("Relentless")
                  ? "\u{26A1}"
                  : personality.name.includes("Weekend")
                    ? "\u{1F3D6}"
                    : "\u{2600}\u{FE0F}"}
        </div>
        <div className="wrap-lead">You are a</div>
        <div className="wrap-hero">{personality.name}</div>
        {personality.desc && (
          <div className="wrap-sub" style={{ color: "#64748b", fontSize: 12 }}>
            {personality.desc}
          </div>
        )}
      </div>
      <div className="p2-stats">
        <div className="p2-stat">
          <span className="p2-stat-val purple">{formatTokens(viewTokens)}</span>
          <span className="p2-stat-lbl">tokens</span>
        </div>
        <div className="p2-stat-sep" />
        <div className="p2-stat">
          <span className="p2-stat-val blue">{formatCost(viewCost)}</span>
          <span className="p2-stat-lbl">spent</span>
        </div>
        <div className="p2-stat-sep" />
        <div className="p2-stat">
          <span className="p2-stat-val green">{viewActiveDays}d</span>
          <span className="p2-stat-lbl">active</span>
        </div>
      </div>
      {achievements.length > 0 && (
        <div className="p2-badges">
          <div className="p2-badges-title">Badges Earned</div>
          <div className="p2-badge-row">
            {achievements.slice(0, 4).map((a) => (
              <div className="p2-pill" key={a.name}>
                <AchievementSvg icon={a.icon} color={a.color} />
                <span>{a.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function renderActivitySlide(p: SlideProps): React.ReactElement {
  const { data, statView, hourBars, cardTheme, viewCost, viewCacheSaved, activityCategories, actCatColors } = p;
  const s = data.stats;
  return (
    <div className="card-content">
      <div className="top-row" style={{ marginBottom: 20 }}>
        <div className="brand">PELLAMETRIC</div>
        <div className="page-title">Activity</div>
      </div>
      {statView !== "codex" ? (
        <>
          <SectionHead title="Activity by Hour" sub="When you code the most throughout the day" />
          <div className="hour-chart" style={{ height: 100, marginBottom: 4 }}>
            {hourBars.map((val, i) => (
              <div
                key={i}
                className="hour-bar pop"
                style={{
                  height: `${Math.max(val * 100, 5)}%`,
                  background: getHourBarColor(val),
                }}
              />
            ))}
          </div>
          <div className="hour-labels">
            <span>12am</span>
            <span>6am</span>
            <span>12pm</span>
            <span>6pm</span>
            <span>11pm</span>
          </div>
        </>
      ) : (
        <>
          <div className="hm-ti" style={{ marginBottom: 8 }}>
            Codex Insights
          </div>
          <div className="stats" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 8 }}>
            <div className="sc">
              <div className="sc-l">Tool Calls</div>
              <div className="sc-v purple">{(s.codex.totalToolCalls ?? 0).toLocaleString()}</div>
            </div>
            <div className="sc">
              <div className="sc-l">Reasoning</div>
              <div className="sc-v blue">{(s.codex.totalReasoningBlocks ?? 0).toLocaleString()}</div>
            </div>
            <div className="sc">
              <div className="sc-l">Web Searches</div>
              <div className="sc-v green">{(s.codex.totalWebSearches ?? 0).toLocaleString()}</div>
            </div>
          </div>
        </>
      )}
      <div className="cost-hero" style={{ marginTop: 20 }}>
        <div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 32,
              fontWeight: 700,
              color: cardTheme === "cream" ? "#1a1a2e" : "#e2e8f0",
              lineHeight: 1,
            }}
          >
            {formatCost(viewCost)}
          </div>
          <div className="sc-l" style={{ fontSize: 10, marginTop: 6 }}>
            total spend
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 32,
              fontWeight: 700,
              color: cardTheme === "cream" ? "#3a9a7a" : "#6e8a6f",
              lineHeight: 1,
            }}
          >
            {viewCacheSaved}
          </div>
          <div className="sc-l" style={{ fontSize: 10, marginTop: 6 }}>
            saved by caching
          </div>
        </div>
      </div>
      {activityCategories.length > 0 && (
        <>
          <SectionHead title="How You Use AI" sub="What type of work your AI agent does" />
          <div className="tb go" style={{ height: 10 }}>
            {activityCategories.map((cat, i) => (
              <div
                key={cat.category}
                style={{
                  flex: cat.sessionPct,
                  background: actCatColors[i % actCatColors.length],
                  borderRadius: 3,
                }}
              />
            ))}
          </div>
          <div className="tb-leg" style={{ marginTop: 20 }}>
            {activityCategories.map((cat, i) => (
              <span key={cat.category} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 2,
                    background: actCatColors[i % actCatColors.length],
                    display: "inline-block",
                  }}
                />
                {cat.category} {cat.sessionPct}%
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function renderToolsSlide(p: SlideProps): React.ReactElement {
  const { data, statView, topTools, cardTheme } = p;
  const s = data.stats;
  const viewTools =
    statView === "codex"
      ? (s.codex.topTools ?? []).slice(0, 5)
      : statView === "claude"
        ? topTools
        : topTools;
  return (
    <div className="card-content">
      <div className="top-row">
        <div className="brand">PELLAMETRIC</div>
        <div className="page-title">Tools</div>
      </div>
      {(() => {
        if (viewTools.length === 0)
          return (
            <div
              style={{
                padding: "20px 0",
                textAlign: "center",
                color: cardTheme === "cream" ? "rgba(26,26,46,.25)" : "rgba(255,255,255,.25)",
                fontSize: 11,
              }}
            >
              No tool data available
            </div>
          );
        const top = viewTools[0];
        if (!top) return null;
        const topDisplay = getToolDisplay(top.name);
        const rest = viewTools.slice(1);
        return (
          <>
            <SectionHead title="Top Tools" sub="Most used capabilities by your AI agent" />
            {/* Hero: #1 tool */}
            <div className="tool-hero">
              <div className="tool-hero-rank">#1</div>
              <div className="tool-hero-name">{topDisplay.name}</div>
              <div className="tool-hero-count">{formatTokens(top.count)}</div>
              <div className="tool-hero-desc">{topDisplay.desc || "calls"}</div>
            </div>
            {/* Rest as grid */}
            <div className="tool-grid">
              {rest.map((t, i) => {
                const display = getToolDisplay(t.name);
                return (
                  <div className="tool-card" key={t.name}>
                    <div className="tool-card-rank">#{i + 2}</div>
                    <div className="tool-card-name">{display.name}</div>
                    <div className="tool-card-count">{formatTokens(t.count)}</div>
                    {display.desc && <div className="tool-card-desc">{display.desc}</div>}
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}
    </div>
  );
}

function renderModelsSlide(p: SlideProps): React.ReactElement {
  const { viewModels, cardTheme } = p;
  // Determine which agent logo to show based on top model
  const topModelName = viewModels[0]?.name?.toLowerCase() ?? "";
  const isClaude =
    topModelName.includes("opus") || topModelName.includes("sonnet") || topModelName.includes("haiku");
  const isCodex = topModelName.includes("codex") || topModelName.includes("gpt");
  const agentLogo = isClaude ? "/claudecode-color.svg" : isCodex ? "/codex-color.svg" : null;

  return (
    <div className="card-content" style={{ position: "relative", overflow: "hidden" }}>
      {/* Agent logo overlay — big, centered, transparent */}
      {agentLogo && (
        <img
          src={agentLogo}
          alt=""
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "65%",
            height: "auto",
            opacity: cardTheme === "cream" ? 0.06 : 0.08,
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
      )}
      <div style={{ position: "relative", zIndex: 1 }}>
        <div className="top-row">
          <div className="brand">PELLAMETRIC</div>
          <div className="page-title">Models</div>
        </div>
        <SectionHead title="Your Favorite Model" sub="The AI model you used the most" />
        {/* Hero model */}
        <div className="wrap-insight">
          <div className="wrap-emoji">
            {isClaude ? (
              <img src="/claudecode-color.svg" alt="Claude" style={{ width: 32, height: 32 }} />
            ) : isCodex ? (
              <img src="/codex-color.svg" alt="Codex" style={{ width: 32, height: 32 }} />
            ) : (
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke={cardTheme === "cream" ? "#7a6299" : "#8fb078"}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            )}
          </div>
          <div className="wrap-lead">You love to work with</div>
          <div className="wrap-hero">{viewModels[0] ? shortModelName(viewModels[0].name) : "Unknown"}</div>
          <div className="wrap-sub">
            {viewModels[0]?.sessions.toLocaleString() ?? 0} sessions {"·"}{" "}
            {viewModels[0] ? formatCost(viewModels[0].cost) : "$0"} spent
          </div>
        </div>
        {/* Other models */}
        <div className="wrap-others" style={{ marginTop: 15 }}>
          {viewModels.slice(1).map((m, i) => {
            const mLower = m.name.toLowerCase();
            const mIsClaude =
              mLower.includes("opus") || mLower.includes("sonnet") || mLower.includes("haiku");
            const mIsCodex = mLower.includes("codex") || mLower.includes("gpt");
            return (
              <div className="wrap-other" key={m.name}>
                <div className="wrap-other-rank" style={{ fontSize: 14, color: "#6e8a6f", fontWeight: 800 }}>
                  #{i + 2}
                </div>
                {mIsClaude ? (
                  <img src="/claudecode-color.svg" alt="" style={{ width: 10, height: 10 }} />
                ) : mIsCodex ? (
                  <img src="/codex-color.svg" alt="" style={{ width: 10, height: 10 }} />
                ) : (
                  <div
                    className="mdot"
                    style={{
                      background: getModelColors(m.name),
                      width: 8,
                      height: 8,
                    }}
                  />
                )}
                <span className="wrap-other-name">{shortModelName(m.name)}</span>
                <span className="wrap-other-val">{formatCost(m.cost)}</span>
                <span className="wrap-other-sessions">{m.sessions.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function renderProjectsSlide(p: SlideProps): React.ReactElement {
  const { viewProjects, cardTheme } = p;
  return (
    <div className="card-content">
      <div className="top-row">
        <div className="brand">PELLAMETRIC</div>
        <div className="page-title">Projects</div>
      </div>
      <SectionHead title="Your Top Project" sub="Where you spent the most time with AI" />
      <div className="wrap-insight" style={{ paddingBottom: 16 }}>
        <div className="wrap-emoji">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke={cardTheme === "cream" ? "#7a6299" : "#8fb078"}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div className="wrap-lead">You built the most in</div>
        <div className="wrap-hero">{viewProjects[0]?.name ?? "Unknown"}</div>
        <div className="wrap-sub">
          {viewProjects[0]?.sessions.toLocaleString() ?? 0} sessions {"·"}{" "}
          {viewProjects[0] ? formatCost(viewProjects[0].cost) : "$0"} spent
        </div>
      </div>
      <div className="wrap-others">
        {viewProjects.slice(1, 5).map((p, i) => (
          <div className="wrap-other" key={p.name}>
            <div className="wrap-other-rank" style={{ fontSize: 14, color: "#6e8a6f", fontWeight: 800 }}>
              #{i + 2}
            </div>
            <div
              className="mdot"
              style={{
                background: p.source === "codex" ? "#8fb078" : "#8fb078",
                width: 8,
                height: 8,
              }}
            />
            <span className="wrap-other-name">{p.name}</span>
            <span className="wrap-other-val">{formatCost(p.cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderAnalyticsSlide(p: SlideProps): React.ReactElement {
  const { data, statView, dailyDist, viewProjects, projectMapSize, show, viewCost, viewTokens } = p;
  const s = data.stats;
  // ─── Analytics page ───
  const viewToolCalls =
    statView === "claude"
      ? (s.claude.totalToolCalls ?? 0)
      : statView === "codex"
        ? (s.codex.totalToolCalls ?? 0)
        : (s.claude.totalToolCalls ?? 0) + (s.codex.totalToolCalls ?? 0);
  const viewSessions =
    statView === "claude"
      ? s.claude.sessions
      : statView === "codex"
        ? s.codex.sessions
        : s.combined.totalSessions;
  const daily = dailyDist
    .map((d) => ({
      date: d.date,
      cost:
        statView === "claude"
          ? (d.claudeSessions / Math.max(d.sessions, 1)) * d.cost
          : statView === "codex"
            ? (d.codexSessions / Math.max(d.sessions, 1)) * d.cost
            : d.cost,
    }))
    .filter((d) => !Number.isNaN(d.cost));
  const maxCost = Math.max(...daily.map((d) => d.cost), 0.001);
  const firstDate = daily[0]?.date
    ? new Date(`${daily[0].date}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "";
  const lastDaily = daily[daily.length - 1];
  const lastDate = lastDaily?.date
    ? new Date(`${lastDaily.date}T12:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "";
  const chartW = 324;
  const chartH = 84;
  const linePath =
    daily.length > 1
      ? daily
          .map((d, i) => {
            const x = (i / (daily.length - 1)) * chartW;
            const y = chartH - (d.cost / maxCost) * chartH;
            return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ")
      : "";
  const areaPath = linePath ? `${linePath} L${chartW},${chartH} L0,${chartH} Z` : "";
  const projBars = viewProjects.slice(0, 5);
  const projMax = Math.max(...projBars.map((p) => p.cost), 0.001);
  const peakCost = Math.max(...daily.map((d) => d.cost), 0);
  const peakIdx = daily.findIndex((d) => d.cost === peakCost);
  const peakDate =
    peakIdx >= 0 && daily[peakIdx]?.date
      ? new Date(`${daily[peakIdx].date}T12:00:00`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })
      : "";
  return (
    <div className="card-content">
      <div className="top-row">
        <div className="brand">PELLAMETRIC</div>
        <div className="page-title">Analytics</div>
      </div>
      <SectionHead title="Analytics" sub="Session costs and activity patterns" />
      <div className="an-stats">
        <div className="an-stat">
          <span className="an-stat-val">{viewSessions.toLocaleString()}</span>
          <span className="an-stat-lbl">Sessions</span>
        </div>
        <div className="an-stat">
          <span className="an-stat-val blue">{formatCost(viewCost)}</span>
          <span className="an-stat-lbl">Cost</span>
        </div>
        <div className="an-stat">
          <span className="an-stat-val purple">{formatTokens(viewTokens)}</span>
          <span className="an-stat-lbl">Tokens</span>
        </div>
        <div className="an-stat">
          <span className="an-stat-val green">{formatTokens(viewToolCalls)}</span>
          <span className="an-stat-lbl">Tool Calls</span>
        </div>
      </div>
      <div className="an-section">
        <div className="an-section-head">
          <span className="an-section-title">Cost Over Time</span>
          {peakDate && (
            <span className="an-section-meta">
              peak {formatCost(peakCost)} {"·"} {peakDate}
            </span>
          )}
        </div>
        <div className="an-chart-wrap">
          {linePath ? (
            <svg
              width="100%"
              height={chartH}
              viewBox={`0 0 ${chartW} ${chartH}`}
              preserveAspectRatio="none"
              className="an-chart"
            >
              <defs>
                <linearGradient id="an-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8fb078" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#8fb078" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={areaPath} fill="url(#an-fill)" />
              <path
                d={linePath}
                fill="none"
                stroke="#8fb078"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <div className="an-chart-empty">Not enough data yet</div>
          )}
          <div className="an-chart-labels">
            <span>{firstDate}</span>
            <span>{lastDate}</span>
          </div>
        </div>
      </div>
      <div className="an-section">
        <div className="an-section-head">
          <span className="an-section-title">Cost by Project</span>
          <span className="an-section-meta">{projectMapSize} projects</span>
        </div>
        <div className="an-bars">
          {projBars.map((p) => (
            <div className="an-bar-row" key={p.name}>
              <span className="an-bar-label">{p.name}</span>
              <div className="an-bar-track">
                <div
                  className={`an-bar-fill ${show ? "go" : ""}`}
                  style={{ "--an-bar-pct": `${(p.cost / projMax) * 100}%` } as React.CSSProperties}
                />
              </div>
              <span className="an-bar-val">{formatCost(p.cost)}</span>
            </div>
          ))}
          {projBars.length === 0 && <div className="an-chart-empty">No projects yet</div>}
        </div>
      </div>
    </div>
  );
}

function renderSummarySlide(p: SlideProps): React.ReactElement {
  const { viewTokens, viewCost, viewCacheSaved, viewActiveDays, mostExpensive, cardTheme } = p;
  return (
    <div className="card-content">
      <div className="top-row">
        <div className="brand">PELLAMETRIC</div>
        <div className="page-title">Summary</div>
      </div>
      <SectionHead title="Your Coding Journey" sub="Everything at a glance" />
      <div className="sum-grid">
        <div className="sum-card">
          <div
            className="sum-val"
            style={{ color: cardTheme === "cream" ? "#1a1a2e" : "#e2e8f0" }}
          >
            {formatTokens(viewTokens)}
          </div>
          <div className="sum-label">tokens generated</div>
        </div>
        <div className="sum-card">
          <div className="sum-val" style={{ color: "#6e8a6f" }}>
            {formatCost(viewCost)}
          </div>
          <div className="sum-label">total spent</div>
        </div>
        <div className="sum-card">
          <div className="sum-val" style={{ color: "#6e8a6f" }}>
            {viewCacheSaved}
          </div>
          <div className="sum-label">saved by caching</div>
        </div>
        <div className="sum-card">
          <div className="sum-val" style={{ color: "#b07b3e" }}>
            {viewActiveDays}d
          </div>
          <div className="sum-label">active</div>
        </div>
      </div>
      {mostExpensive && (
        <div className="sum-callout">
          <div className="sum-callout-label">Biggest single session</div>
          <div className="sum-callout-val">{formatCost(mostExpensive.cost)}</div>
          <div className="sum-callout-project">
            {cleanProjectName(mostExpensive.project)} {"·"} {mostExpensive.date}
          </div>
        </div>
      )}
      <div className="sum-footer">
        <div className="sum-tagline">illuminate your code</div>
      </div>
    </div>
  );
}

/**
 * Single dispatch component — picks the right slide renderer for the
 * current page. Kept as one file per CHALLENGE S-1: 8 separate
 * `SlideN.tsx` files would duplicate the reveal/transitionDelay plumbing
 * and all share the same `SlideProps` shape anyway.
 */
export function Slide({ page, ...props }: { page: number } & SlideProps): React.ReactElement | null {
  switch (page) {
    case 0:
      return renderIdentitySlide(props);
    case 1:
      return renderPersonalitySlide(props);
    case 2:
      return renderActivitySlide(props);
    case 3:
      return renderToolsSlide(props);
    case 4:
      return renderModelsSlide(props);
    case 5:
      return renderProjectsSlide(props);
    case 6:
      return renderAnalyticsSlide(props);
    case 7:
      return renderSummarySlide(props);
    default:
      return null;
  }
}
