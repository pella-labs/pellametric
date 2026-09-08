// F2.13/14/15/16/17 — PostHog-style insight builder.
// Client component. Reads/writes the InsightQuery via `?q=<base64>`. Posts to
// /api/insights/query for results. Manager-scope queries enforce k-anonymity
// in the compiler; the UI shows an EmptyState in that error case.

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type InsightQuery,
  type InsightMetric,
  type InsightBreakdown,
  type InsightFilter,
  type InsightResult,
  type TimePoint,
  type BreakdownRow,
  DEFAULT_QUERY,
  decodeQuery,
  encodeQuery,
} from "@/lib/insights/query-types";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { SkeletonChart, SkeletonTable } from "@/components/data/skeleton";
import { EmptyState } from "@/components/data/empty-state";

const METRICS: { value: InsightMetric; label: string; unit: string; goodDir: "up" | "down" }[] = [
  { value: "tokens_out", label: "Tokens out", unit: "tokens", goodDir: "up" },
  { value: "tokens_in", label: "Tokens in", unit: "tokens", goodDir: "up" },
  { value: "tokens_cache_read", label: "Cache reads", unit: "tokens", goodDir: "up" },
  { value: "cost_usd", label: "Cost", unit: "USD", goodDir: "down" },
  { value: "sessions", label: "Sessions", unit: "sessions", goodDir: "up" },
  { value: "wall_sec", label: "Wall time", unit: "seconds", goodDir: "up" },
  { value: "errors", label: "Errors", unit: "errors", goodDir: "down" },
  { value: "prs_merged", label: "PRs merged", unit: "PRs", goodDir: "up" },
];

const BREAKDOWNS: { value: InsightBreakdown; label: string }[] = [
  { value: "source", label: "Source" },
  { value: "model", label: "Model" },
  { value: "repo", label: "Repo" },
  { value: "intent_top", label: "Intent" },
  { value: "user", label: "User" },
  { value: "day_of_week", label: "Day of week" },
  { value: "none", label: "Total" },
];

const RANGES = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
] as const;

const MODES = [
  { value: "trends", label: "Trends", icon: "▲", metric: "tokens_out" as const, breakdown: "source" as const },
  { value: "sessions", label: "Sessions", icon: "◉", metric: "sessions" as const, breakdown: "source" as const },
  { value: "prs", label: "PRs", icon: "◼", metric: "prs_merged" as const, breakdown: "user" as const },
  { value: "devs", label: "Devs", icon: "◈", metric: "sessions" as const, breakdown: "user" as const },
  { value: "waste", label: "Waste", icon: "◆", metric: "errors" as const, breakdown: "source" as const },
  { value: "intent", label: "Intent", icon: "◊", metric: "sessions" as const, breakdown: "intent_top" as const },
  { value: "cost", label: "Cost", icon: "$", metric: "cost_usd" as const, breakdown: "model" as const },
  { value: "funnels", label: "Funnels", icon: "◇", metric: "sessions" as const, breakdown: "none" as const, comingSoon: true },
];

type SavedInsight = {
  id: string;
  name: string;
  description: string | null;
  scope: "org" | "user";
  queryJson: InsightQuery;
};

export type InsightBuilderProps = {
  orgSlug: string;
  provider: string;
  /** "org" routes through manager scope; "user" through caller scope. */
  scope: "org" | "user";
  /** For the page header. */
  orgDisplayName: string;
  /** Caller's role in the org — gates save-as-org. */
  role: "manager" | "dev";
};

function fmt(v: number, metric: InsightMetric): string {
  if (metric === "cost_usd") return `$${v.toFixed(2)}`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString();
}

export function InsightBuilder({
  orgSlug,
  provider,
  scope,
  orgDisplayName,
  role,
}: InsightBuilderProps): React.ReactElement {
  const router = useRouter();
  const sp = useSearchParams();

  // Initial query from ?q=, else default. Stored in a ref to avoid SSR/CSR drift.
  const [query, setQuery] = useState<InsightQuery>(() => decodeQuery(sp.get("q")) ?? DEFAULT_QUERY);
  const [result, setResult] = useState<InsightResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<SavedInsight[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push the encoded query into the URL whenever it changes (shareable links).
  const url = useMemo(() => `?q=${encodeQuery(query)}`, [query]);
  useEffect(() => {
    const current = sp.get("q");
    const next = encodeQuery(query);
    if (current !== next) {
      router.replace(url, { scroll: false });
    }
    // intentionally not depending on sp — we read it once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Fetch result whenever query changes. Debounced to absorb rapid clicks.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      fetch("/api/insights/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, scope: { kind: scope, orgSlug, provider } }),
      })
        .then(r => r.json())
        .then((j: InsightResult) => setResult(j))
        .catch(() => setResult({ ok: false, error: "k_anonymity", required: 0, actual: 0 }))
        .finally(() => setLoading(false));
    }, 180);
  }, [query, scope, orgSlug, provider]);

  // Load saved insights for the sidebar.
  const loadSaved = useCallback(() => {
    // Managers can see org-scope; everyone sees their own user-scope.
    const targetScope = scope === "org" ? "org" : "user";
    fetch(`/api/insights/saved?orgSlug=${encodeURIComponent(orgSlug)}&scope=${targetScope}&provider=${provider}`, {
      cache: "no-store",
    })
      .then(r => r.json())
      .then((j: { items: SavedInsight[] }) => setSaved(j.items ?? []))
      .catch(() => setSaved([]));
  }, [orgSlug, provider, scope]);
  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  function updateQuery(patch: Partial<InsightQuery>) {
    setQuery(q => ({ ...q, ...patch }));
  }

  function addFilter(field: InsightFilter["field"], value: string) {
    setQuery(q => {
      const existing = q.filters.find(f => f.field === field);
      if (existing) {
        if (existing.values.includes(value)) return q;
        return {
          ...q,
          filters: q.filters.map(f =>
            f.field === field ? { ...f, values: [...f.values, value] } : f,
          ),
        };
      }
      return { ...q, filters: [...q.filters, { field, values: [value] }] };
    });
  }
  function removeFilter(field: InsightFilter["field"]) {
    setQuery(q => ({ ...q, filters: q.filters.filter(f => f.field !== field) }));
  }

  const isError = result && !result.ok;

  return (
    <div className="min-h-screen bg-(--background) text-(--foreground)">
      <div className="p-6 space-y-6">
        <header className="space-y-2">
          <p className="mk-eyebrow">{scope === "org" ? "Manager view" : "Personal view"}</p>
          <h1 className="mk-heading text-2xl">Insights</h1>
        </header>

        {/* Mode pills — horizontal so this page composes inside the outer nav-rail layout. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {MODES.map(m => {
            const active = query.metric === m.metric && query.breakdown === m.breakdown;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => {
                  if ("comingSoon" in m && m.comingSoon) return;
                  updateQuery({ metric: m.metric, breakdown: m.breakdown });
                }}
                className={`mk-table-cell border border-(--border) rounded-[var(--radius)] px-2.5 py-1 flex items-center gap-1.5 ${
                  active
                    ? "bg-(--secondary) text-(--foreground) border-(--border-hover)"
                    : "text-(--muted-foreground) hover:text-(--foreground) hover:border-(--border-hover)"
                }`}
                disabled={"comingSoon" in m && m.comingSoon}
              >
                <span className="text-(--accent)" aria-hidden>{m.icon}</span>
                {m.label}
                {"comingSoon" in m && m.comingSoon && (
                  <span className="text-(--ink-faint)">· soon</span>
                )}
              </button>
            );
          })}
          <span className="text-(--ink-faint) mx-2">|</span>
          <span className="mk-label text-(--muted-foreground)">Saved:</span>
          {saved.length === 0 && (
            <span className="mk-table-cell text-(--ink-faint)">none yet</span>
          )}
          {saved.slice(0, 5).map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setQuery(s.queryJson)}
              className="mk-table-cell border border-(--border) hover:border-(--border-hover) rounded-[var(--radius)] px-2 py-1 inline-flex items-center gap-1"
              title={s.description ?? s.name}
            >
              <span className="truncate max-w-[120px]">{s.name}</span>
              {s.scope === "org" && <span className="text-(--ink-faint)">·org</span>}
            </button>
          ))}
        </div>

        {/* Builder */}
        <section className="mk-panel grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="mk-label">Metric</label>
            <select
              className="mt-1 w-full bg-(--background) border border-(--border) rounded-[var(--radius)] px-2 py-1.5 mk-table-cell"
              value={query.metric}
              onChange={e => updateQuery({ metric: e.target.value as InsightMetric })}
            >
              {METRICS.map(m => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mk-label">Breakdown</label>
            <select
              className="mt-1 w-full bg-(--background) border border-(--border) rounded-[var(--radius)] px-2 py-1.5 mk-table-cell"
              value={query.breakdown}
              onChange={e => updateQuery({ breakdown: e.target.value as InsightBreakdown })}
            >
              {BREAKDOWNS.map(b => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mk-label">Range</label>
            <select
              className="mt-1 w-full bg-(--background) border border-(--border) rounded-[var(--radius)] px-2 py-1.5 mk-table-cell"
              value={query.range.kind === "preset" ? query.range.preset : "30d"}
              onChange={e =>
                updateQuery({
                  range: { kind: "preset", preset: e.target.value as "7d" | "30d" | "90d" },
                })
              }
            >
              {RANGES.map(r => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mk-label">Granularity</label>
            <select
              className="mt-1 w-full bg-(--background) border border-(--border) rounded-[var(--radius)] px-2 py-1.5 mk-table-cell"
              value={query.granularity}
              onChange={e => updateQuery({ granularity: e.target.value as "day" | "week" })}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
            </select>
          </div>

          {/* Filter chips */}
          <div className="md:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-2">
            <span className="mk-label">Filters</span>
            {query.filters.length === 0 && (
              <span className="mk-table-cell text-(--ink-faint)">none</span>
            )}
            {query.filters.map(f => (
              <button
                key={f.field}
                type="button"
                onClick={() => removeFilter(f.field)}
                className="mk-table-cell border border-(--border) hover:border-(--destructive) rounded-[var(--radius)] px-2 py-1 inline-flex items-center gap-2"
              >
                <span className="text-(--muted-foreground)">{f.field}</span>
                <span className="text-(--foreground)">= {f.values.join(", ")}</span>
                <span className="text-(--destructive)" aria-hidden>
                  ✕
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Chart */}
        <section className="mk-panel">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <p className="mk-label">{METRICS.find(m => m.value === query.metric)?.label ?? query.metric}</p>
              {result && result.ok && (
                <p className="mk-stat-numeric text-(--foreground)">
                  {fmt(
                    result.breakdown.reduce((s, r) => s + r.total, 0),
                    query.metric,
                  )}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(window.location.href)}
                className="mk-table-cell border border-(--border) hover:border-(--border-hover) rounded-[var(--radius)] px-2 py-1"
              >
                Share URL
              </button>
              <button
                type="button"
                onClick={() => setSaveOpen(true)}
                className="mk-table-cell border border-(--border) hover:border-(--border-hover) rounded-[var(--radius)] px-2 py-1"
              >
                Save as insight
              </button>
            </div>
          </div>

          {loading && !result && <SkeletonChart width="100%" height={320} />}
          {!loading && isError && (
            <EmptyState
              headline="Cohort too small to show aggregate."
              summary={`This view needs at least ${
                !result.ok ? result.required : 5
              } distinct contributors. Currently ${!result.ok ? result.actual : 0}.`}
              diagnostics={[
                { label: "Try widening the filter set" },
                { label: "Try a longer time range" },
                { label: "Wait for more contributors before slicing this finely" },
              ]}
              escapeHatches={[
                { href: `/org/${provider}/${orgSlug}/devs`, label: "Open devs leaderboard" },
                { href: `/org/${provider}/${orgSlug}`, label: "Back to overview" },
              ]}
            />
          )}
          {!loading && result && result.ok && (
            <TimeSeriesChart
              data={result.series as TimePoint[]}
              width={Math.max(320, 980)}
              height={320}
              variant={query.breakdown === "none" ? "line" : "stacked"}
            />
          )}
        </section>

        {/* Breakdown */}
        <section className="mk-panel">
          <p className="mk-label mb-2">Breakdown</p>
          {loading && !result && (
            <SkeletonTable rows={6} columns="120px 1fr 80px 60px" />
          )}
          {!loading && result && result.ok && (
            <BreakdownTable rows={result.breakdown} metric={query.metric} />
          )}
        </section>
      </div>
      {saveOpen && (
        <SaveModal
          onClose={() => setSaveOpen(false)}
          onSaved={() => {
            setSaveOpen(false);
            loadSaved();
          }}
          query={query}
          orgSlug={orgSlug}
          provider={provider}
          canSaveOrg={role === "manager"}
        />
      )}
    </div>
  );
}

function BreakdownTable({
  rows,
  metric,
}: {
  rows: BreakdownRow[];
  metric: InsightMetric;
}): React.ReactElement {
  if (rows.length === 0) {
    return <p className="mk-table-cell text-(--muted-foreground)">no rows</p>;
  }
  return (
    <table className="w-full mk-table-cell">
      <thead>
        <tr className="text-left border-b border-(--border) text-(--muted-foreground)">
          <th className="py-2 pr-2">Key</th>
          <th className="py-2 px-2 text-right">{metric}</th>
          <th className="py-2 px-2 text-right">Sessions</th>
          <th className="py-2 pl-2 text-right">Users</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.key} className="border-b border-(--border)">
            <td className="py-2 pr-2 text-(--foreground)">{r.label}</td>
            <td className="py-2 px-2 text-right text-(--foreground)">{fmt(r.total, metric)}</td>
            <td className="py-2 px-2 text-right text-(--muted-foreground)">
              {r.sessions?.toLocaleString() ?? "—"}
            </td>
            <td className="py-2 pl-2 text-right text-(--muted-foreground)">
              {r.users ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SaveModal({
  onClose,
  onSaved,
  query,
  orgSlug,
  provider,
  canSaveOrg,
}: {
  onClose: () => void;
  onSaved: () => void;
  query: InsightQuery;
  orgSlug: string;
  provider: string;
  canSaveOrg: boolean;
}): React.ReactElement {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"org" | "user">(canSaveOrg ? "org" : "user");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    const res = await fetch("/api/insights/saved", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgSlug,
        provider,
        scope,
        name,
        description: description || undefined,
        queryJson: query,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setErr("Save failed");
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <form
        onSubmit={submit}
        className="mk-panel w-full max-w-md space-y-4 bg-(--card)"
      >
        <h3 className="mk-heading text-lg">Save insight</h3>
        <div>
          <label className="mk-label">Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            required
            className="mt-1 w-full bg-(--background) border border-(--border) rounded-[var(--radius)] px-2 py-1.5 mk-table-cell"
          />
        </div>
        <div>
          <label className="mk-label">Description (optional)</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            className="mt-1 w-full bg-(--background) border border-(--border) rounded-[var(--radius)] px-2 py-1.5 mk-table-cell"
          />
        </div>
        {canSaveOrg && (
          <div>
            <label className="mk-label">Visibility</label>
            <div className="mt-1 flex gap-3 mk-table-cell">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="scope"
                  checked={scope === "org"}
                  onChange={() => setScope("org")}
                />
                Shared with org managers
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="scope"
                  checked={scope === "user"}
                  onChange={() => setScope("user")}
                />
                Only me
              </label>
            </div>
          </div>
        )}
        {err && <p className="mk-table-cell text-(--destructive)">{err}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="mk-table-cell border border-(--border) hover:border-(--border-hover) rounded-[var(--radius)] px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name}
            className="mk-table-cell rounded-[var(--radius)] px-3 py-1.5 bg-(--accent) text-(--accent-foreground) disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
