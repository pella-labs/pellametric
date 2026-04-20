"use client";

import type { schemas } from "@bematist/api";
import { Fragment, type MouseEvent as ReactMouseEvent, useMemo, useRef, useState } from "react";
import "../new-dashboard.css";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const INT = new Intl.NumberFormat("en-US");
const TOK = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PAGE_SIZE = 5;

interface Props {
  data: schemas.ActivityOverviewOutput;
  window: "7d" | "30d" | "90d";
}

export function ActivitySection({ data, window }: Props) {
  const { kpis, daily, heatmap, top_tools, top_models } = data;
  const maxHeat = Math.max(1, ...heatmap.map((h) => h.sessions));

  const toolAudit = useMemo(() => auditTools(top_tools), [top_tools]);
  const modelAudit = useMemo(() => auditModels(top_models), [top_models]);

  return (
    <section className="newdash-section" data-newdash-section="activity">
      <h2>Activity</h2>
      <p className="newdash-section-sub">What happened in the last {windowLabel(window)}.</p>

      <div className="newdash-kpi-row">
        <div className="newdash-card">
          <span className="newdash-card-label">Sessions</span>
          <span className="newdash-card-value">{INT.format(kpis.sessions)}</span>
          <span className="newdash-card-hint">
            across {INT.format(kpis.active_days)} active days
          </span>
        </div>
        <div className="newdash-card">
          <span className="newdash-card-label">Spend</span>
          <span className="newdash-card-value">{USD.format(kpis.spend_usd)}</span>
          <span className="newdash-card-hint">
            avg {USD.format(kpis.avg_session_cost)} / session
          </span>
        </div>
        <div className="newdash-card">
          <span className="newdash-card-label">Input tokens</span>
          <span className="newdash-card-value">{TOK.format(kpis.input_tokens)}</span>
          <span className="newdash-card-hint">cache read {TOK.format(kpis.cache_read_tokens)}</span>
        </div>
        <div className="newdash-card">
          <span className="newdash-card-label">Output tokens</span>
          <span className="newdash-card-value">{TOK.format(kpis.output_tokens)}</span>
          <span className="newdash-card-hint">
            {kpis.sessions > 0 ? INT.format(Math.round(kpis.output_tokens / kpis.sessions)) : "0"} /
            session
          </span>
        </div>
      </div>

      <div className="newdash-grid-2">
        <div className="newdash-card">
          <span className="newdash-card-label">Daily spend</span>
          <DailyTrend daily={daily} />
        </div>
        <div className="newdash-card">
          <span className="newdash-card-label">When your team ships</span>
          <Heatmap heatmap={heatmap} max={maxHeat} />
        </div>
      </div>

      <div className="newdash-grid-2">
        <div className="newdash-card">
          <span className="newdash-card-label">Top tools</span>
          {top_tools.length === 0 ? (
            <div className="newdash-empty">No tool usage in this window yet.</div>
          ) : (
            <LoadMoreTable
              rows={top_tools}
              columns={[
                { key: "tool", label: "Tool", align: "left" },
                { key: "calls", label: "Calls", align: "right" },
                { key: "errors", label: "Errors", align: "right" },
              ]}
              renderRow={(t) => (
                <>
                  <td>{t.tool_name}</td>
                  <td style={{ textAlign: "right" }}>{INT.format(t.calls)}</td>
                  <td style={{ textAlign: "right" }}>{INT.format(t.errors)}</td>
                </>
              )}
              rowKey={(t) => t.tool_name}
            />
          )}
          {toolAudit.duplicateGroups.length > 0 ? (
            <AuditBanner
              label="Possible duplicates"
              groups={toolAudit.duplicateGroups}
              hint="Same name in different casings — already collapsed server-side via lower()."
            />
          ) : null}
        </div>
        <div className="newdash-card">
          <span className="newdash-card-label">Top models</span>
          {top_models.length === 0 ? (
            <div className="newdash-empty">
              No model attribution yet — this fills in as sessions ship.
            </div>
          ) : (
            <LoadMoreTable
              rows={top_models}
              columns={[
                { key: "model", label: "Model", align: "left" },
                { key: "sessions", label: "Sessions", align: "right" },
                { key: "spend", label: "Spend", align: "right" },
              ]}
              renderRow={(m) => (
                <>
                  <td title={m.model}>{m.model}</td>
                  <td style={{ textAlign: "right" }}>{INT.format(m.sessions)}</td>
                  <td style={{ textAlign: "right" }}>{USD.format(m.spend_usd)}</td>
                </>
              )}
              rowKey={(m) => m.model}
            />
          )}
          {modelAudit.duplicateGroups.length > 0 ? (
            <AuditBanner
              label="Likely same model, different SKU"
              groups={modelAudit.duplicateGroups}
              hint="Provider returns both dated (e.g. 20250929) and alias (e.g. claude-sonnet-4-5) SKUs. Counted separately today."
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function windowLabel(window: "7d" | "30d" | "90d"): string {
  if (window === "7d") return "7 days";
  if (window === "90d") return "90 days";
  return "30 days";
}

// ---- Daily trend with hover tooltip -------------------------------------

function DailyTrend({ daily }: { daily: schemas.ActivityDailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (daily.length === 0) {
    return <div className="newdash-empty">No activity in this window yet.</div>;
  }

  const width = 100;
  const height = 80;
  const maxSpend = Math.max(1, ...daily.map((d) => d.spend_usd));
  const stepX = daily.length > 1 ? width / (daily.length - 1) : width;
  const pts = daily.map((d, i) => {
    const x = daily.length === 1 ? width / 2 : i * stepX;
    const y = height - (d.spend_usd / maxSpend) * height;
    return { x, y, d, i };
  });
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const hoveredPoint = hover !== null ? pts[hover] : null;
  const hoveredDay = hoveredPoint?.d;

  const onMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(xRatio * (daily.length - 1));
    const clamped = Math.max(0, Math.min(daily.length - 1, idx));
    setHover(clamped);
  };

  return (
    <div className="newdash-trend newdash-trend--interactive">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <title>Daily spend ($) over the filter window</title>
        <polyline
          points={polyline}
          fill="none"
          stroke="var(--mk-accent)"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
        />
        {hoveredPoint ? (
          <>
            <line
              x1={hoveredPoint.x}
              x2={hoveredPoint.x}
              y1={0}
              y2={height}
              stroke="var(--mk-accent)"
              strokeWidth={0.5}
              strokeDasharray="2 2"
              vectorEffect="non-scaling-stroke"
              opacity={0.55}
            />
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.y}
              r={1.8}
              fill="var(--mk-accent)"
              stroke="var(--mk-bg-elevated)"
              strokeWidth={0.75}
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : null}
      </svg>
      {hoveredPoint && hoveredDay ? (
        <div
          className="newdash-trend-tooltip"
          style={{
            left: `${(hoveredPoint.x / width) * 100}%`,
          }}
        >
          <div className="newdash-trend-tooltip__day">{formatDay(hoveredDay.day)}</div>
          <div>
            <span className="newdash-trend-tooltip__label">Spend</span>
            <span>{USD.format(hoveredDay.spend_usd)}</span>
          </div>
          <div>
            <span className="newdash-trend-tooltip__label">Sessions</span>
            <span>{INT.format(hoveredDay.sessions)}</span>
          </div>
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.7rem",
          color: "var(--mk-ink-faint)",
        }}
      >
        <span>{daily[0]?.day}</span>
        <span>{USD.format(maxSpend)} peak</span>
        <span>{daily[daily.length - 1]?.day}</span>
      </div>
    </div>
  );
}

function formatDay(iso: string): string {
  // iso is "YYYY-MM-DD" — render as "Apr 20, 2026"
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ---- Heatmap with custom hover tooltip ----------------------------------

interface HeatmapHover {
  dow: number;
  hour: number;
  sessions: number;
  x: number;
  y: number;
}

function Heatmap({ heatmap, max }: { heatmap: schemas.ActivityHeatmapCell[]; max: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<HeatmapHover | null>(null);

  const byDow = useMemo(() => {
    const m = new Map<number, Map<number, number>>();
    for (const c of heatmap) {
      const row = m.get(c.dow) ?? new Map();
      row.set(c.hour, c.sessions);
      m.set(c.dow, row);
    }
    return m;
  }, [heatmap]);

  const focusCell = (cell: HTMLElement, dow: number, hour: number) => {
    const sessions = byDow.get(dow)?.get(hour) ?? 0;
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    setHover({
      dow,
      hour,
      sessions,
      x: cellRect.left - containerRect.left + cellRect.width / 2,
      y: cellRect.top - containerRect.top,
    });
  };

  return (
    <div className="newdash-heatmap-wrap" ref={containerRef}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: grid of button cells; container uses mouseleave for tooltip dismissal */}
      <div className="newdash-heatmap" onMouseLeave={() => setHover(null)}>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} style={{ textAlign: "center" }}>
            {h % 6 === 0 ? h : ""}
          </span>
        ))}
        {DOW_LABELS.map((label, dow) => (
          <Fragment key={`dow-${dow}`}>
            <span>{label}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const v = byDow.get(dow)?.get(h) ?? 0;
              const alpha = max > 0 ? v / max : 0;
              return (
                <button
                  type="button"
                  key={`${dow}-${h}`}
                  className="newdash-heatmap-cell"
                  aria-label={`${DOW_LABELS[dow]} ${formatHour(h)} — ${v} sessions`}
                  style={{
                    backgroundColor: `rgba(110, 138, 111, ${0.08 + alpha * 0.9})`,
                  }}
                  onMouseEnter={(e) => focusCell(e.currentTarget, dow, h)}
                  onFocus={(e) => focusCell(e.currentTarget, dow, h)}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
      {hover ? (
        <div
          className="newdash-heatmap-tooltip"
          style={{
            left: hover.x,
            top: hover.y,
          }}
          role="tooltip"
        >
          <div className="newdash-heatmap-tooltip__head">
            {DOW_LABELS[hover.dow]} · {formatHour(hover.hour)}
          </div>
          <div>
            <span className="newdash-heatmap-tooltip__label">Sessions</span>
            <span>{INT.format(hover.sessions)}</span>
          </div>
        </div>
      ) : null}
      <div style={{ fontSize: "0.7rem", color: "var(--mk-ink-faint)", marginTop: "0.25rem" }}>
        Each cell is an hour of the week; deeper sage = more sessions.
      </div>
    </div>
  );
}

function formatHour(h: number): string {
  const pad = h.toString().padStart(2, "0");
  return `${pad}:00`;
}

// ---- Load-more table -----------------------------------------------------

interface TableColumn {
  key: string;
  label: string;
  align: "left" | "right";
}

interface LoadMoreTableProps<Row> {
  rows: Row[];
  columns: TableColumn[];
  renderRow: (row: Row) => React.ReactNode;
  rowKey: (row: Row) => string;
}

function LoadMoreTable<Row>({ rows, columns, renderRow, rowKey }: LoadMoreTableProps<Row>) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, PAGE_SIZE);
  const hasMore = rows.length > PAGE_SIZE;
  return (
    <>
      <table className="newdash-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={rowKey(r)}>{renderRow(r)}</tr>
          ))}
        </tbody>
      </table>
      {hasMore ? (
        <button type="button" className="newdash-loadmore" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show less" : `Load more (${rows.length - PAGE_SIZE})`}
        </button>
      ) : null}
    </>
  );
}

// ---- Audit helpers -------------------------------------------------------

interface DuplicateGroup {
  canonical: string;
  members: string[];
}

function auditTools(tools: schemas.TopTool[]): { duplicateGroups: DuplicateGroup[] } {
  const groups = new Map<string, string[]>();
  for (const t of tools) {
    const key = t.tool_name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const members = groups.get(key) ?? [];
    members.push(t.tool_name);
    groups.set(key, members);
  }
  const duplicateGroups: DuplicateGroup[] = [];
  for (const [canonical, members] of groups) {
    if (members.length > 1) duplicateGroups.push({ canonical, members });
  }
  return { duplicateGroups };
}

function auditModels(models: schemas.TopModel[]): { duplicateGroups: DuplicateGroup[] } {
  // Strip trailing dated SKU (`-20250929`, `-20251101`, `@20250929`) and
  // trailing provider-specific version tags so `claude-sonnet-4-5-20250929`
  // and `claude-sonnet-4-5` collapse into the same audit group.
  const groups = new Map<string, string[]>();
  for (const m of models) {
    const key = normalizeModelId(m.model);
    const members = groups.get(key) ?? [];
    members.push(m.model);
    groups.set(key, members);
  }
  const duplicateGroups: DuplicateGroup[] = [];
  for (const [canonical, members] of groups) {
    if (members.length > 1) duplicateGroups.push({ canonical, members });
  }
  return { duplicateGroups };
}

function normalizeModelId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[@:_-]?20\d{6}\b/g, "")
    .replace(/[@:_-]?v\d+(\.\d+)*$/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function AuditBanner({
  label,
  groups,
  hint,
}: {
  label: string;
  groups: DuplicateGroup[];
  hint: string;
}) {
  return (
    <div className="newdash-audit">
      <div className="newdash-audit__head">{label}</div>
      <ul className="newdash-audit__list">
        {groups.slice(0, 3).map((g) => (
          <li key={g.canonical}>
            {g.members.map((member, idx) => (
              <Fragment key={member}>
                {idx > 0 ? <span className="newdash-audit__sep"> ≈ </span> : null}
                <code>{member}</code>
              </Fragment>
            ))}
          </li>
        ))}
      </ul>
      <div className="newdash-audit__hint">{hint}</div>
    </div>
  );
}
