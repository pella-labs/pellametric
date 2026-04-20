"use client";

import type { schemas } from "@bematist/api";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { buildHref, type Filter } from "../_filter";

interface Props {
  filter: Filter;
  cohorts: schemas.CohortFiltersOutput;
  /** Resolved CH engineer_id (developer.id) for the caller — never the
   * Better Auth user_id. Kept here only so the toggle can detect "Just me"
   * state from URL params. */
  myEngineerId: string;
  /** Caller's display name (Better Auth `name`, or email-local-part). */
  myName: string;
}

const WINDOWS: Array<{ label: string; value: "7d" | "30d" | "90d" }> = [
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
  { label: "Last 90 days", value: "90d" },
];

export function FilterBar({ filter, cohorts, myEngineerId, myName }: Props) {
  const router = useRouter();
  const justMe =
    (filter.engineer_ids ?? []).length === 1 && filter.engineer_ids?.[0] === myEngineerId;
  // "Refreshed HH:MM:SS" is a client-local wall-clock stamp. Computing it
  // during render causes SSR (server time) and client hydration (browser
  // time) to produce different strings a second or two apart → hydration
  // mismatch. Start empty and fill in after mount so both renders agree.
  const [updated, setUpdated] = useState<string | null>(null);
  useEffect(() => {
    setUpdated(new Date().toLocaleTimeString());
  }, []);
  const selectedRepos = filter.repo_ids ?? [];
  const [reposOpen, setReposOpen] = useState(false);

  const repoLabel =
    selectedRepos.length === 0
      ? "All repos"
      : selectedRepos.length === 1
        ? (cohorts.repos.find((r) => r.id === selectedRepos[0])?.full_name ?? "1 repo")
        : `${selectedRepos.length} repos`;

  function navigate(patch: Partial<Filter & { justMe?: boolean | null }>) {
    router.push(buildHref(filter, patch));
  }

  function toggleRepo(repoId: string) {
    const next = selectedRepos.includes(repoId)
      ? selectedRepos.filter((id) => id !== repoId)
      : [...selectedRepos, repoId];
    navigate({ repo_ids: next.length === 0 ? undefined : next });
  }

  return (
    <section
      aria-label="Dashboard filters"
      className="newdash-filterbar"
      data-new-dashboard-filters="true"
    >
      <label className="newdash-control">
        <span className="newdash-control-label">Window</span>
        <select
          className="newdash-select"
          value={filter.window}
          onChange={(e) => {
            navigate({ window: e.target.value as Filter["window"] });
          }}
        >
          {WINDOWS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
      </label>

      <div className="newdash-control" style={{ position: "relative" }}>
        <span className="newdash-control-label">Repos</span>
        <button
          type="button"
          className="newdash-select newdash-select-button"
          onClick={() => setReposOpen((v) => !v)}
          data-active={selectedRepos.length > 0}
        >
          {repoLabel} ▾
        </button>
        {reposOpen && (
          <div className="newdash-dropdown" role="listbox" aria-label="Filter by repo">
            {cohorts.repos.length === 0 ? (
              <div className="newdash-dropdown-empty">No tracked repos yet.</div>
            ) : (
              <>
                {selectedRepos.length > 0 && (
                  <button
                    type="button"
                    className="newdash-dropdown-item newdash-dropdown-clear"
                    onClick={() => {
                      navigate({ repo_ids: undefined });
                      setReposOpen(false);
                    }}
                  >
                    Clear repo filter
                  </button>
                )}
                {cohorts.repos.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    className="newdash-dropdown-item"
                    data-active={selectedRepos.includes(r.id)}
                    onClick={() => toggleRepo(r.id)}
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={selectedRepos.includes(r.id)}
                      tabIndex={-1}
                    />
                    {r.full_name}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <fieldset className="newdash-toggle" data-just-me={justMe}>
        <legend className="newdash-control-label" style={{ position: "absolute", left: -9999 }}>
          Scope
        </legend>
        <button
          type="button"
          className="newdash-toggle-btn"
          data-active={!justMe}
          onClick={() => {
            navigate({ engineer_ids: undefined, justMe: null });
          }}
        >
          Team
        </button>
        <button
          type="button"
          className="newdash-toggle-btn"
          data-active={justMe}
          onClick={() => {
            navigate({ justMe: true, engineer_ids: undefined });
          }}
        >
          Just me
        </button>
      </fieldset>

      <span className="newdash-filterbar-meta">
        {updated ? `Refreshed ${updated}` : ""}
        {myName ? `${updated ? " · " : ""}signed in as ${myName}` : ""}
      </span>
    </section>
  );
}
