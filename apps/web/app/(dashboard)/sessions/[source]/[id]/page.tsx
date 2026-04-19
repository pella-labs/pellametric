import { Card, CardHeader, CardTitle } from "@bematist/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyableId } from "@/components/CopyableId";
import { SourceBadge } from "@/components/SourceBadge";
import { getLocalData } from "@/lib/local-sources";
import {
  classifyTurns,
  loadTranscript,
  type TranscriptSource,
  type TranscriptTurn,
} from "@/lib/session-transcript";

export const metadata: Metadata = {
  title: "Session transcript",
};

export const dynamic = "force-dynamic";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const INT = new Intl.NumberFormat("en-US");
const TOK = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

const VALID_SOURCES: TranscriptSource[] = ["claude-code", "codex", "cursor"];

function isValidSource(s: string): s is TranscriptSource {
  return (VALID_SOURCES as string[]).includes(s);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function ToolBubble({ turn }: { turn: TranscriptTurn }) {
  const isError = turn.tool?.status === "error";
  return (
    <details className="rounded border border-border/40 bg-muted/10 px-3 py-2 text-xs">
      <summary className="cursor-pointer select-none flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded px-1.5 py-0.5 font-medium ${
            isError ? "bg-red-500/15 text-red-400" : "bg-muted text-muted-foreground"
          }`}
        >
          🛠 {turn.tool?.name ?? "tool"}
          {isError ? " · error" : ""}
        </span>
        <span className="text-muted-foreground font-mono truncate max-w-[40rem]">
          {truncate((turn.tool?.input ?? turn.content ?? "").replace(/\s+/g, " "), 140)}
        </span>
      </summary>
      {turn.tool?.input ? (
        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground overflow-x-auto">
          {turn.tool.input}
        </pre>
      ) : null}
      {turn.tool?.output ? (
        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground overflow-x-auto border-t border-border/40 pt-2">
          {turn.tool.output}
        </pre>
      ) : null}
    </details>
  );
}

function fmtDurationMs(ms: number): string {
  if (!ms || ms < 1000) return `${ms || 0}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

interface MetaTile {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "muted" | "warn";
}

function MetaPanel({
  title,
  tiles,
  footer,
}: {
  title: string;
  tiles: MetaTile[];
  footer?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 text-sm">
        {tiles.map((t) => (
          <div key={t.label}>
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div
              className={`mt-1 text-lg font-semibold tabular-nums ${
                t.tone === "warn" ? "text-amber-400" : ""
              }`}
            >
              {t.value}
            </div>
            {t.sub ? (
              <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{t.sub}</div>
            ) : null}
          </div>
        ))}
      </div>
      {footer ? <div className="mt-4">{footer}</div> : null}
    </Card>
  );
}

function TurnBubble({ turn }: { turn: TranscriptTurn }) {
  if (turn.role === "tool") return <ToolBubble turn={turn} />;
  const isUser = turn.role === "user";
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        isUser ? "border-blue-500/30 bg-blue-500/5" : "border-border/40 bg-muted/10"
      }`}
    >
      <div className="flex items-center justify-between gap-3 text-xs mb-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded px-2 py-0.5 font-medium ${
              isUser ? "bg-blue-500/15 text-blue-400" : "bg-muted text-muted-foreground"
            }`}
          >
            {isUser ? "You" : "Assistant"}
          </span>
          {turn.model ? (
            <span className="font-mono text-muted-foreground">{turn.model}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-3 text-muted-foreground">
          {turn.tokens?.input || turn.tokens?.output ? (
            <span className="tabular-nums">
              {TOK.format((turn.tokens.input ?? 0) + (turn.tokens.output ?? 0))} tok
            </span>
          ) : null}
          {turn.timestamp ? <span>{turn.timestamp.replace("T", " ").slice(0, 19)}</span> : null}
        </div>
      </div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">{turn.content}</div>
    </div>
  );
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ source: string; id: string }>;
}) {
  const { source, id: encodedId } = await params;
  if (!isValidSource(source)) notFound();
  const id = decodeURIComponent(encodedId);

  const [transcript, localData] = await Promise.all([loadTranscript(source, id), getLocalData()]);
  const shape = classifyTurns(transcript.totals);

  // Look up the source-specific session aggregate from grammata's cached
  // data — richer than what we reconstruct from the raw transcript file.
  const claudeSession =
    source === "claude-code" ? localData.claude?.sessions.find((s) => s.sessionId === id) : null;
  const codexSession =
    source === "codex" ? localData.codex?.sessions.find((s) => s.sessionId === id) : null;
  const cursorSession =
    source === "cursor" ? localData.cursor?.sessions.find((s) => s.sessionId === id) : null;

  const metaPanel: React.ReactNode = (() => {
    if (claudeSession) {
      return (
        <MetaPanel
          title="Session metadata"
          tiles={[
            { label: "Cost", value: USD.format(claudeSession.costUsd) },
            {
              label: "Input tokens",
              value: TOK.format(claudeSession.inputTokens),
              sub: `+ ${TOK.format(claudeSession.cacheReadTokens)} cache read`,
            },
            {
              label: "Output tokens",
              value: TOK.format(claudeSession.outputTokens),
              sub: `+ ${TOK.format(claudeSession.cacheCreateTokens)} cache create`,
            },
            { label: "Duration", value: fmtDurationMs(claudeSession.durationMs) },
            { label: "Model", value: claudeSession.model || "—" },
            { label: "Project", value: claudeSession.project || "—" },
            {
              label: "Git branch",
              value: claudeSession.gitBranch || "—",
            },
            {
              label: "Retries",
              value: `${claudeSession.retryCount}/${claudeSession.totalEditTurns || claudeSession.retryCount}`,
              sub: claudeSession.mostRetriedFile
                ? `worst: ${claudeSession.mostRetriedFile.split("/").pop()}`
                : "",
              tone: claudeSession.retryCount > 0 ? "warn" : "default",
            },
          ]}
        />
      );
    }
    if (codexSession) {
      return (
        <MetaPanel
          title="Session metadata"
          tiles={[
            { label: "Cost", value: USD.format(codexSession.costUsd) },
            {
              label: "Input tokens",
              value: TOK.format(codexSession.inputTokens),
              sub: `+ ${TOK.format(codexSession.cachedInputTokens)} cached`,
            },
            { label: "Output tokens", value: TOK.format(codexSession.outputTokens) },
            { label: "Duration", value: fmtDurationMs(codexSession.durationMs) },
            { label: "Model", value: codexSession.model || "—" },
            { label: "Project", value: codexSession.project || "—" },
            { label: "Git branch", value: codexSession.gitBranch || "—" },
            { label: "Approval mode", value: codexSession.approvalMode || "—" },
            {
              label: "Reasoning blocks",
              value: INT.format(codexSession.reasoningBlocks),
              sub:
                codexSession.webSearches > 0
                  ? `${INT.format(codexSession.webSearches)} web search${codexSession.webSearches === 1 ? "" : "es"}`
                  : "",
            },
            {
              label: "Retries",
              value: INT.format(codexSession.retryCount),
              tone: codexSession.retryCount > 0 ? "warn" : "default",
            },
          ]}
        />
      );
    }
    if (cursorSession) {
      return (
        <MetaPanel
          title="Session metadata"
          footer={
            <p className="text-xs text-muted-foreground">
              Cursor runs on a subscription, so per-turn tokens aren&apos;t billed and aren&apos;t
              recorded — SQLite exposes zero token counts by design. The cost below is
              grammata&apos;s rough estimate based on message count × model pricing, useful for
              relative comparison across sessions but not an actual charge.
            </p>
          }
          tiles={[
            {
              label: "Cost (est., subscription)",
              value: USD.format(cursorSession.costUsd),
              sub: "estimate only",
            },
            { label: "Messages", value: INT.format(cursorSession.messageCount) },
            {
              label: "Lines added",
              value: `+${INT.format(cursorSession.linesAdded)}`,
            },
            {
              label: "Lines removed",
              value: `−${INT.format(cursorSession.linesRemoved)}`,
            },
            { label: "Model", value: cursorSession.model || "—" },
            { label: "Mode", value: cursorSession.mode || "—" },
            { label: "Project", value: cursorSession.project || "(no project)" },
            {
              label: "Created",
              value: cursorSession.createdAt
                ? cursorSession.createdAt.slice(0, 19).replace("T", " ")
                : "—",
            },
          ]}
        />
      );
    }
    return null;
  })();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/sessions" className="hover:underline">
            ← all sessions
          </Link>
        </div>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Session transcript</h1>
          <SourceBadge source={source} />
          <CopyableId value={id} label="session id" />
        </div>
        {transcript.path ? (
          <p className="text-xs text-muted-foreground font-mono truncate">{transcript.path}</p>
        ) : null}
      </header>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <div className="text-xs text-amber-400/90 leading-relaxed">
          <strong>Local view.</strong> Prompts shown here are read directly from your disk (
          <code>~/.claude</code>, <code>~/.codex</code>, Cursor SQLite). Nothing is sent to any
          server. This is your own <code>/me</code> view — the team dashboard never renders prompt
          text without the IC&apos;s explicit Tier-C opt-in (CLAUDE.md §Privacy Rules D7/D8).
        </div>
      </Card>

      {metaPanel}

      {transcript.path === null ? (
        <Card>
          <CardHeader>
            <CardTitle>Session file not found</CardTitle>
          </CardHeader>
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t locate a session file for <span className="font-mono">{id}</span> under{" "}
            {source === "claude-code"
              ? "~/.claude/projects"
              : source === "codex"
                ? "~/.codex/sessions"
                : "Cursor SQLite"}
            . Claude Code and Codex purge logs older than their retention policy; the aggregate row
            still shows in Summary because grammata cached it.
          </p>
        </Card>
      ) : (
        <>
          <section
            className={`grid grid-cols-2 gap-4 text-sm ${
              source === "cursor" ? "md:grid-cols-4" : "md:grid-cols-5"
            }`}
          >
            <Card>
              <div className="text-xs text-muted-foreground">Shape</div>
              <div className="mt-1 text-lg font-semibold">{shape}</div>
            </Card>
            <Card>
              <div className="text-xs text-muted-foreground">Your prompts</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {INT.format(transcript.totals.userTurns)}
              </div>
            </Card>
            <Card>
              <div className="text-xs text-muted-foreground">Assistant turns</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {INT.format(transcript.totals.assistantTurns)}
              </div>
            </Card>
            <Card>
              <div className="text-xs text-muted-foreground">Tool calls</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {INT.format(transcript.totals.toolTurns)}
              </div>
              {transcript.totals.toolErrors > 0 ? (
                <div className="mt-1 text-xs text-red-400 tabular-nums">
                  {INT.format(transcript.totals.toolErrors)} errors
                </div>
              ) : null}
            </Card>
            {source !== "cursor" ? (
              <Card>
                <div className="text-xs text-muted-foreground">Tokens</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {TOK.format(
                    transcript.totals.inputTokens +
                      transcript.totals.outputTokens +
                      transcript.totals.cacheReadTokens +
                      transcript.totals.cacheCreateTokens,
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                  cache read {TOK.format(transcript.totals.cacheReadTokens)}
                </div>
              </Card>
            ) : null}
          </section>

          <section className="flex flex-col gap-3">
            {transcript.turns.length === 0 ? (
              <Card>
                <p className="text-sm text-muted-foreground">
                  No user/assistant turns found in this file.
                </p>
              </Card>
            ) : (
              transcript.turns.map((t) => <TurnBubble key={t.seq} turn={t} />)
            )}
          </section>
        </>
      )}
    </div>
  );
}
