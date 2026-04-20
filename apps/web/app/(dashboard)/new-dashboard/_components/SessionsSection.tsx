"use client";

import type { schemas } from "@bematist/api";
import { useEffect, useState } from "react";
import type { Filter } from "../_filter";
import { SessionDrawer } from "./SessionDrawer";
import "../new-dashboard.css";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const INT = new Intl.NumberFormat("en-US");
const TOK = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const TIME = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface Props {
  initial: schemas.SessionsFeedOutput;
  filter: Filter;
}

export function SessionsSection({ initial, filter }: Props) {
  const [page, setPage] = useState(initial);
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setPage(initial);
  }, [initial]);

  async function loadMore() {
    if (!page.page_info.has_more || !page.page_info.cursor) return;
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams({
        window: filter.window,
        cursor: page.page_info.cursor,
      });
      if (filter.engineer_ids?.length) qs.set("eng", filter.engineer_ids.join(","));
      if (filter.repo_ids?.length) qs.set("repo", filter.repo_ids.join(","));
      const res = await fetch(`/api/new-dashboard/sessions?${qs}`, { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as schemas.SessionsFeedOutput;
      setPage((prev) => ({
        page_info: next.page_info,
        rows: [...prev.rows, ...next.rows],
      }));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="newdash-section" data-newdash-section="sessions">
      <h2>Sessions</h2>
      <p className="newdash-section-sub">
        Every agent session captured in this window. Click a row to see the timeline and linked PRs.
      </p>
      {page.rows.length === 0 ? (
        <div className="newdash-empty">No sessions matched these filters yet.</div>
      ) : (
        <div className="newdash-card" style={{ padding: 0 }}>
          <div style={{ overflowX: "auto" }}>
            <table className="newdash-table">
              <thead>
                <tr>
                  <th style={{ width: "9rem" }}>Started</th>
                  <th style={{ width: "7rem" }}>Teammate</th>
                  <th>Repo</th>
                  <th style={{ width: "8rem" }}>Branch</th>
                  <th style={{ width: "5rem", textAlign: "right" }}>Minutes</th>
                  <th style={{ width: "5rem", textAlign: "right" }}>Spend</th>
                  <th style={{ width: "5rem", textAlign: "right" }}>Tokens</th>
                  <th style={{ width: "4rem", textAlign: "right" }}>Tools</th>
                  <th style={{ width: "4rem", textAlign: "right" }}>PRs</th>
                  <th style={{ width: "7rem" }}>Model</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map((r) => (
                  <tr
                    // Composite key: the CH query groups by (session_id,
                    // engineer_id), so a session whose events carry mixed
                    // engineer_ids surfaces here as two rows sharing the same
                    // session_id. Using session_id alone collides; composing
                    // with engineer_id_hash gives each row a stable identity.
                    key={`${r.session_id}|${r.engineer_id_hash}`}
                    onClick={() => setOpenSession(r.session_id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setOpenSession(r.session_id);
                    }}
                  >
                    <td>{TIME.format(new Date(r.started_at))}</td>
                    <td>#{r.engineer_id_hash}</td>
                    <td title={r.repo_full_name ?? ""}>{r.repo_full_name ?? "—"}</td>
                    <td title={r.branch ?? ""}>{r.branch ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      {r.duration_minutes == null
                        ? "—"
                        : INT.format(Math.round(r.duration_minutes))}
                    </td>
                    <td style={{ textAlign: "right" }}>{USD.format(r.spend_usd)}</td>
                    <td style={{ textAlign: "right" }}>{TOK.format(r.tokens_in + r.tokens_out)}</td>
                    <td style={{ textAlign: "right" }}>{INT.format(r.tool_calls)}</td>
                    <td style={{ textAlign: "right" }}>
                      {r.linked_pr_numbers.length === 0 ? "—" : r.linked_pr_numbers.length}
                    </td>
                    <td title={r.model ?? ""}>{compactModel(r.model)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {page.page_info.has_more ? (
            <div style={{ padding: "0.75rem", textAlign: "center" }}>
              <button
                type="button"
                className="newdash-pill"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </div>
      )}

      {openSession ? (
        <SessionDrawer sessionId={openSession} onClose={() => setOpenSession(null)} />
      ) : null}
    </section>
  );
}

function compactModel(model: string | null): string {
  if (!model) return "—";
  return model.replace(/^claude-/, "c/").replace(/^gpt-/, "g/");
}
