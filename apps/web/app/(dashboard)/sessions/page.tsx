import { Card, CardHeader, CardTitle } from "@bematist/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { SourceBadge } from "@/components/SourceBadge";
import { getLocalData } from "@/lib/local-sources";
import type { SessionShape } from "@/lib/session-transcript";

export const metadata: Metadata = {
  title: "Sessions",
};

export const dynamic = "force-dynamic";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const INT = new Intl.NumberFormat("en-US");
const TOK = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

interface Row {
  source: "claude-code" | "codex" | "cursor";
  id: string;
  timestamp: string;
  model: string;
  project: string;
  userTurns: number;
  tokens: number;
  cost: number;
  shape: SessionShape;
  durationMs: number;
}

// Cheap classification from aggregate fields — avoids opening every transcript
// file on the list page. Accurate-enough for a glanceable column.
function shapeFromCounts(userTurns: number, retryCount: number): SessionShape {
  if (retryCount > 0) return "Fixing";
  if (userTurns <= 1) return "One-shot";
  if (userTurns <= 5) return "Iterative";
  return "Deep-dive";
}

const SHAPE_TONE: Record<SessionShape, string> = {
  "One-shot": "bg-blue-500/15 text-blue-400 border-blue-500/30",
  Iterative: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "Deep-dive": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Fixing: "bg-red-500/15 text-red-400 border-red-500/30",
};

function ShapeBadge({ shape }: { shape: SessionShape }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${SHAPE_TONE[shape]}`}
    >
      {shape}
    </span>
  );
}

/** Cell that wraps its content in a Link so the entire <td> area is clickable,
 *  not just the text inside. Gives the whole row an "a tag" feel without
 *  turning a <tr> into an <a> (invalid HTML). */
function LinkCell({
  href,
  children,
  align = "left",
}: {
  href: string;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td className="p-0">
      <Link
        href={href}
        className={`block py-2 ${align === "right" ? "pr-2 text-right" : "pl-0 pr-2"}`}
      >
        {children}
      </Link>
    </td>
  );
}

function fmtDuration(ms: number): string {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; shape?: string }>;
}) {
  const params = await searchParams;
  const sourceFilter = params.source;
  const shapeFilter = params.shape;

  const { claude, codex, cursor } = await getLocalData();

  const rows: Row[] = [];
  if (claude) {
    for (const s of claude.sessions) {
      const userTurns = Math.max(1, Math.ceil(s.turnCount / 2));
      rows.push({
        source: "claude-code",
        id: s.sessionId,
        timestamp: s.firstTimestamp,
        model: s.model,
        project: s.project,
        userTurns,
        tokens: s.inputTokens + s.outputTokens,
        cost: s.costUsd,
        shape: shapeFromCounts(userTurns, s.retryCount ?? 0),
        durationMs: s.durationMs,
      });
    }
  }
  if (codex) {
    for (const s of codex.sessions) {
      const userTurns = Math.max(1, Math.ceil(s.messageCount / 2));
      rows.push({
        source: "codex",
        id: s.sessionId,
        timestamp: s.createdAt,
        model: s.model,
        project: s.project,
        userTurns,
        tokens: s.inputTokens + s.outputTokens,
        cost: s.costUsd,
        shape: shapeFromCounts(userTurns, s.retryCount ?? 0),
        durationMs: s.durationMs,
      });
    }
  }
  if (cursor) {
    for (const s of cursor.sessions) {
      const userTurns = Math.max(1, Math.ceil(s.messageCount / 2));
      rows.push({
        source: "cursor",
        id: s.sessionId,
        timestamp: s.createdAt,
        model: s.model,
        project: s.project || "(no project)",
        userTurns,
        tokens: 0,
        cost: s.costUsd,
        shape: shapeFromCounts(userTurns, 0),
        durationMs: 0,
      });
    }
  }

  const filtered = rows
    .filter((r) => !sourceFilter || r.source === sourceFilter)
    .filter((r) => !shapeFilter || r.shape === shapeFilter)
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""))
    .slice(0, 500);

  const totalCost = filtered.reduce((a, r) => a + r.cost, 0);
  const totalSessions = filtered.length;

  const shapeCount: Record<SessionShape, number> = {
    "One-shot": 0,
    Iterative: 0,
    "Deep-dive": 0,
    Fixing: 0,
  };
  for (const r of rows) shapeCount[r.shape]++;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
        <p className="text-sm text-muted-foreground">
          Every Claude Code, Codex, and Cursor session on this machine. Click a row to see the full
          prompt/response transcript. Data stays local.
        </p>
      </header>

      <section className="flex flex-wrap gap-2 text-xs">
        <FilterLinks
          current={sourceFilter}
          paramKey="source"
          label="Source"
          options={["claude-code", "codex", "cursor"]}
        />
        <FilterLinks
          current={shapeFilter}
          paramKey="shape"
          label="Shape"
          options={Object.keys(shapeCount)}
        />
        <span className="ml-auto text-muted-foreground">
          {INT.format(totalSessions)} sessions · {USD.format(totalCost)} shown
        </span>
      </section>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4 text-sm">
        {(Object.keys(shapeCount) as SessionShape[]).map((s) => (
          <Card key={s}>
            <div className="flex items-baseline justify-between">
              <ShapeBadge shape={s} />
              <span className="text-xl font-semibold tabular-nums">
                {INT.format(shapeCount[s])}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {s === "One-shot" && "single-prompt sessions"}
              {s === "Iterative" && "2–5 user prompts"}
              {s === "Deep-dive" && "6+ user prompts"}
              {s === "Fixing" && "had a tool error or retry"}
            </div>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Recent sessions</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="pb-2">When</th>
                <th className="pb-2">Source</th>
                <th className="pb-2">Shape</th>
                <th className="pb-2">Session ID</th>
                <th className="pb-2">Model</th>
                <th className="pb-2">Project</th>
                <th className="pb-2 text-right">Turns</th>
                <th className="pb-2 text-right">Duration</th>
                <th className="pb-2 text-right">Tokens</th>
                <th className="pb-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const href = `/sessions/${r.source}/${encodeURIComponent(r.id)}`;
                const idShort = r.id.length > 13 ? `${r.id.slice(0, 8)}…${r.id.slice(-4)}` : r.id;
                return (
                  <tr
                    key={`${r.source}:${r.id}`}
                    className="group border-t border-border/40 hover:bg-muted/30 cursor-pointer"
                  >
                    <LinkCell href={href}>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {r.timestamp ? r.timestamp.replace("T", " ").slice(0, 19) : "—"}
                      </span>
                    </LinkCell>
                    <LinkCell href={href}>
                      <SourceBadge source={r.source} size="xs" />
                    </LinkCell>
                    <LinkCell href={href}>
                      <ShapeBadge shape={r.shape} />
                    </LinkCell>
                    <LinkCell href={href}>
                      <span
                        className="font-mono text-xs text-muted-foreground group-hover:text-primary"
                        title={r.id}
                      >
                        {idShort}
                      </span>
                    </LinkCell>
                    <LinkCell href={href}>
                      <span className="text-xs font-mono group-hover:text-primary">
                        {r.model || "—"}
                      </span>
                    </LinkCell>
                    <LinkCell href={href}>
                      <span className="text-xs truncate max-w-[16rem] inline-block">
                        {r.project}
                      </span>
                    </LinkCell>
                    <LinkCell href={href} align="right">
                      <span className="tabular-nums">{INT.format(r.userTurns)}</span>
                    </LinkCell>
                    <LinkCell href={href} align="right">
                      <span className="tabular-nums text-xs">{fmtDuration(r.durationMs)}</span>
                    </LinkCell>
                    <LinkCell href={href} align="right">
                      <span className="tabular-nums">{r.tokens ? TOK.format(r.tokens) : "—"}</span>
                    </LinkCell>
                    <LinkCell href={href} align="right">
                      <span className="tabular-nums">{r.cost > 0 ? USD.format(r.cost) : "—"}</span>
                    </LinkCell>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function FilterLinks({
  current,
  paramKey,
  label,
  options,
}: {
  current: string | undefined;
  paramKey: string;
  label: string;
  options: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-muted-foreground">{label}:</span>
      <Link
        href="/sessions"
        className={`rounded px-2 py-0.5 border ${
          !current ? "bg-primary/15 border-primary/30" : "border-transparent hover:border-border"
        }`}
      >
        all
      </Link>
      {options.map((o) => (
        <Link
          key={o}
          href={`/sessions?${paramKey}=${encodeURIComponent(o)}`}
          className={`rounded px-2 py-0.5 border ${
            current === o
              ? "bg-primary/15 border-primary/30"
              : "border-transparent hover:border-border"
          }`}
        >
          {o}
        </Link>
      ))}
    </div>
  );
}
