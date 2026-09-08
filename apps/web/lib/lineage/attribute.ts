// Hot-path §4.7 — commit attribution heuristic (verbatim).
// Patched heuristic table from dev-docs/challenger-report.md §C.
// Multi-source array (P6). Bot terminal (P4). Anthropic email alone gets
// +30 unknown (P8). Codex session-join inference (P32). Cursor opt-in (P31).

export type AiSource = "claude" | "codex" | "cursor" | "human" | "bot" | "unknown";

export type CommitForAttribution = {
  authorLogin: string | null;
  authorEmail: string | null;
  committerEmail: string | null;
  message: string;
  additions: number;
  deletions: number;
  files: string[];
};

export type LinkedSessionContext = {
  source: "claude" | "codex" | "cursor";
  confidence: "high" | "medium" | "low";
} | null;

export type OrgFlags = {
  useCursor: boolean;
};

export type AttributionResult = {
  aiSources: AiSource[];
  aiConfidence: number;        // 0..100, highest signal score
  aiSignals: Record<string, unknown>;
};

const BOT_LOGIN_RE = /\[bot\]$/i;
const KNOWN_BOT_EMAILS = new Set([
  "dependabot[bot]@users.noreply.github.com",
  "renovate[bot]@users.noreply.github.com",
  "github-actions[bot]@users.noreply.github.com",
]);

const TRAILER_CLAUDE = /Co-Authored-By:\s*Claude/i;
const TRAILER_CODEX = /Co-Authored-By:\s*(Codex|Codex AI)/i;
const TRAILER_CURSOR = /Co-Authored-By:\s*Cursor/i;
const FOOTER_CLAUDE = /Generated with \[Claude Code\]/i;
const ANTHROPIC_EMAIL = /noreply@anthropic\.com/i;
const CURSOR_EMAIL = /cursor@cursor\.sh/i;

export function scoreCommitAttribution(
  commit: CommitForAttribution,
  linkedSession: LinkedSessionContext,
  orgFlags: OrgFlags,
): AttributionResult {
  const sigs: Record<string, unknown> = {};
  const sources = new Set<AiSource>();
  let topScore = 0;

  // P4: Bot terminal — short-circuit.
  const isBot =
    (commit.authorLogin != null && BOT_LOGIN_RE.test(commit.authorLogin)) ||
    (commit.authorEmail != null && KNOWN_BOT_EMAILS.has(commit.authorEmail)) ||
    (commit.committerEmail != null && KNOWN_BOT_EMAILS.has(commit.committerEmail));
  if (isBot) {
    return {
      aiSources: ["bot"],
      aiConfidence: 100,
      aiSignals: { bot: true, login: commit.authorLogin },
    };
  }

  const msg = commit.message ?? "";
  const hasClaudeTrailer = TRAILER_CLAUDE.test(msg);
  const hasAnthropicEmail =
    (commit.authorEmail != null && ANTHROPIC_EMAIL.test(commit.authorEmail)) ||
    (commit.committerEmail != null && ANTHROPIC_EMAIL.test(commit.committerEmail));
  const hasFooterClaude = FOOTER_CLAUDE.test(msg);
  const hasCodexTrailer = TRAILER_CODEX.test(msg);
  const hasCursorTrailer = TRAILER_CURSOR.test(msg);
  const hasCursorEmail =
    (commit.authorEmail != null && CURSOR_EMAIL.test(commit.authorEmail)) ||
    (commit.committerEmail != null && CURSOR_EMAIL.test(commit.committerEmail));

  // Claude signals.
  if (hasClaudeTrailer && hasAnthropicEmail) {
    sources.add("claude"); topScore = Math.max(topScore, 90);
    sigs.claudeTrailerPlusEmail = true;
  } else if (hasClaudeTrailer) {
    sources.add("claude"); topScore = Math.max(topScore, 60);
    sigs.claudeTrailer = true;
  }
  if (hasFooterClaude) {
    sources.add("claude"); topScore = Math.max(topScore, 90);
    sigs.claudeFooter = true;
  }
  // P8: Anthropic email alone → +30 unknown (NOT claude).
  if (hasAnthropicEmail && !hasClaudeTrailer && !hasFooterClaude) {
    sources.add("unknown"); topScore = Math.max(topScore, 30);
    sigs.anthropicEmailOnly = true;
  }

  // Codex signals.
  if (hasCodexTrailer) {
    sources.add("codex"); topScore = Math.max(topScore, 60);
    sigs.codexTrailer = true;
  }

  // Cursor signals.
  if (hasCursorTrailer || hasCursorEmail) {
    sources.add("cursor"); topScore = Math.max(topScore, hasCursorEmail ? 70 : 60);
    sigs.cursorDirect = true;
  }

  // P32: Codex session-join inference when no trailer.
  if (sources.size === 0 && linkedSession?.source === "codex") {
    sources.add("codex"); topScore = Math.max(topScore, 50);
    sigs.codexSessionJoin = true;
  }

  // P31: Cursor opt-in session-join inference.
  if (sources.size === 0 && orgFlags.useCursor && linkedSession?.source === "cursor") {
    sources.add("cursor"); topScore = Math.max(topScore, 50);
    sigs.cursorOptInJoin = true;
  }

  // P6: Multi-source — already supported via Set accumulation above.
  if (sources.size === 0) {
    sources.add("human"); topScore = Math.max(topScore, 0);
  }

  return {
    aiSources: Array.from(sources),
    aiConfidence: topScore,
    aiSignals: sigs,
  };
}
