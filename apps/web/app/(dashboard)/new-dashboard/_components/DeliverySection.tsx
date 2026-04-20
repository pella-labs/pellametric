import type { schemas } from "@bematist/api";
import "../new-dashboard.css";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const INT = new Intl.NumberFormat("en-US");
const PCT = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });

interface Props {
  data: schemas.CodeDeliveryOutput;
}

export function DeliverySection({ data }: Props) {
  // size_distribution intentionally hidden until github_pull_requests
  // has additions/deletions backfilled — every PR currently shows up
  // as XS because the webhook payload doesn't carry diff stats.
  const { pr_kpis, merge_latency, weekly_throughput, pr_by_repo, subscription } = data;

  return (
    <section className="newdash-section" data-newdash-section="delivery">
      <h2>Code delivery</h2>
      <p className="newdash-section-sub">How PRs are moving through GitHub in this window.</p>

      {subscription && subscription.active_engineers > 0 && (
        <SubscriptionHero subscription={subscription} />
      )}

      <div className="newdash-kpi-row">
        <div className="newdash-card">
          <span className="newdash-card-label">Opened</span>
          <span className="newdash-card-value">{INT.format(pr_kpis.opened)}</span>
        </div>
        <div className="newdash-card">
          <span className="newdash-card-label">Merged</span>
          <span className="newdash-card-value">{INT.format(pr_kpis.merged)}</span>
        </div>
        <div className="newdash-card">
          <span className="newdash-card-label">Open now</span>
          <span className="newdash-card-value">{INT.format(pr_kpis.open_now)}</span>
        </div>
        <div className="newdash-card">
          <span className="newdash-card-label">Revert rate</span>
          <span className="newdash-card-value">
            {pr_kpis.revert_pct == null ? "—" : PCT.format(pr_kpis.revert_pct)}
          </span>
        </div>
      </div>

      <div className="newdash-kpi-row">
        <div className="newdash-card">
          <span className="newdash-card-label">Median time to merge</span>
          <span className="newdash-card-value">
            {merge_latency.median_hours == null ? "—" : formatHours(merge_latency.median_hours)}
          </span>
          <span className="newdash-card-hint">
            p90 {merge_latency.p90 == null ? "—" : formatHours(merge_latency.p90)}
          </span>
        </div>
        <div className="newdash-card">
          <span className="newdash-card-label">First-try rate</span>
          <span className="newdash-card-value">
            {pr_kpis.first_try_pct == null ? "—" : PCT.format(pr_kpis.first_try_pct)}
          </span>
        </div>
        <div className="newdash-card">
          <span className="newdash-card-label">Commits without a PR</span>
          <span className="newdash-card-value">{INT.format(data.commits_without_pr)}</span>
        </div>
      </div>

      <div className="newdash-cost-card">
        <span className="newdash-card-label">Cost per merged PR</span>
        {data.cost_per_merged_pr == null ? (
          <>
            <span className="newdash-cost-value">—</span>
            <span className="newdash-card-hint">
              Waiting for the linker to connect sessions to PRs. Once a handful of merged PRs have a
              matching session, this number shows up.
            </span>
          </>
        ) : (
          <>
            <span className="newdash-cost-value">{USD.format(data.cost_per_merged_pr)}</span>
            <span className="newdash-card-hint">
              {USD.format(data.cost_per_merged_pr * pr_kpis.merged)} ÷ {INT.format(pr_kpis.merged)}{" "}
              merged PRs
            </span>
          </>
        )}
      </div>

      <div className="newdash-card">
        <span className="newdash-card-label">Weekly throughput</span>
        {weekly_throughput.length === 0 ? (
          <div className="newdash-empty">No PR activity in this window yet.</div>
        ) : (
          <WeeklyThroughputBars data={weekly_throughput} />
        )}
      </div>

      <div className="newdash-card">
        <span className="newdash-card-label">PRs by repo</span>
        {pr_by_repo.length === 0 ? (
          <div className="newdash-empty">No PRs from any tracked repo in this window.</div>
        ) : (
          <table className="newdash-table">
            <thead>
              <tr>
                <th>Repo</th>
                <th style={{ textAlign: "right" }}>Opened</th>
                <th style={{ textAlign: "right" }}>Merged</th>
                <th style={{ textAlign: "right" }}>Open now</th>
                <th style={{ textAlign: "right" }}>Median time to merge</th>
              </tr>
            </thead>
            <tbody>
              {pr_by_repo.slice(0, 12).map((r) => (
                <tr key={r.full_name}>
                  <td>{r.full_name}</td>
                  <td style={{ textAlign: "right" }}>{INT.format(r.opened)}</td>
                  <td style={{ textAlign: "right" }}>{INT.format(r.merged)}</td>
                  <td style={{ textAlign: "right" }}>{INT.format(r.open_now)}</td>
                  <td style={{ textAlign: "right" }}>
                    {r.median_ttm_hours == null ? "—" : formatHours(r.median_ttm_hours)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="newdash-card">
        <span className="newdash-card-label">Per-developer delivery + spend</span>
        <span className="newdash-card-hint">
          Spend columns join sessions to that author&rsquo;s PRs (same head branch or commit SHA in
          the merge window). &ldquo;Wasted on unmerged&rdquo; is spend on sessions whose linked PRs
          never merged — closed, abandoned, or still open.
        </span>
        {data.cohort_gated ? (
          <div className="newdash-note">
            Your team is small. We&rsquo;ll unlock per-teammate breakdowns once at least 5 of your
            teammates are actively shipping events. Use &ldquo;Just me&rdquo; in the filter bar to
            see your own numbers any time.
          </div>
        ) : data.pr_by_author.length === 0 ? (
          <div className="newdash-empty">No PR authors in this window.</div>
        ) : (
          <div className="newdash-scroll-x">
            <table className="newdash-table newdash-table-wide">
              <thead>
                <tr>
                  <th>Teammate</th>
                  <th style={{ textAlign: "right" }}>Opened</th>
                  <th style={{ textAlign: "right" }}>Merged</th>
                  <th style={{ textAlign: "right" }}>Reverts</th>
                  <th style={{ textAlign: "right" }}>Spend</th>
                  <th style={{ textAlign: "right" }}>$ / merged PR</th>
                  <th style={{ textAlign: "right" }}>Wasted on unmerged</th>
                  <th style={{ textAlign: "right" }}>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {data.pr_by_author.map((a) => {
                  const wastePct =
                    a.spend_usd && a.spend_usd > 0 && a.spend_on_unmerged_usd != null
                      ? a.spend_on_unmerged_usd / a.spend_usd
                      : null;
                  return (
                    <tr key={a.author_hash}>
                      <td>#{a.author_hash}</td>
                      <td style={{ textAlign: "right" }}>{INT.format(a.opened)}</td>
                      <td style={{ textAlign: "right" }}>{INT.format(a.merged)}</td>
                      <td style={{ textAlign: "right" }}>{INT.format(a.revert_count)}</td>
                      <td style={{ textAlign: "right" }}>
                        {a.spend_usd == null ? "—" : USD.format(a.spend_usd)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {a.cost_per_merged_pr == null ? "—" : USD.format(a.cost_per_merged_pr)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {a.spend_on_unmerged_usd == null ? (
                          "—"
                        ) : (
                          <>
                            {USD.format(a.spend_on_unmerged_usd)}
                            {wastePct != null && wastePct > 0 ? (
                              <span
                                style={{
                                  marginLeft: 6,
                                  color:
                                    wastePct >= 0.4
                                      ? "var(--mk-warm)"
                                      : wastePct >= 0.2
                                        ? "var(--mk-ink-muted)"
                                        : "var(--mk-ink-faint)",
                                  fontSize: "0.7rem",
                                }}
                              >
                                {PCT.format(wastePct)}
                              </span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {a.tokens == null
                          ? "—"
                          : new Intl.NumberFormat("en-US", { notation: "compact" }).format(
                              a.tokens,
                            )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function SubscriptionHero({ subscription }: { subscription: schemas.SubscriptionSummary }) {
  const sub = subscription;
  const utilization =
    sub.subscription_cost_usd > 0 ? sub.actual_spend_usd / sub.subscription_cost_usd : 0;
  const saving = sub.savings_usd >= 0;
  const tone = saving ? "var(--mk-accent)" : "var(--mk-warm)";
  const utilPct = Math.min(1, Math.max(0, utilization));
  return (
    <div className="newdash-cost-card" style={{ borderColor: tone }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span className="newdash-card-label">
          Spend vs subscription · {sub.window_days}d · {sub.active_engineers} active engineer
          {sub.active_engineers === 1 ? "" : "s"}
        </span>
        <span className="newdash-card-hint">{sub.plan_label}</span>
      </div>
      <div
        style={{
          display: "flex",
          gap: "2.5rem",
          alignItems: "baseline",
          flexWrap: "wrap",
          marginTop: "0.5rem",
        }}
      >
        <div>
          <div className="newdash-card-hint">Actual API spend</div>
          <div className="newdash-cost-value">{USD.format(sub.actual_spend_usd)}</div>
        </div>
        <div>
          <div className="newdash-card-hint">Subscription value</div>
          <div className="newdash-cost-value" style={{ color: "var(--mk-ink-muted)" }}>
            {USD.format(sub.subscription_cost_usd)}
          </div>
        </div>
        <div>
          <div className="newdash-card-hint">{saving ? "Savings vs API pricing" : "Overage"}</div>
          <div className="newdash-cost-value" style={{ color: tone }}>
            {saving ? "+" : ""}
            {USD.format(sub.savings_usd)}
          </div>
        </div>
      </div>
      <div
        aria-label={`Subscription utilization ${PCT.format(utilization)}`}
        style={{
          height: 6,
          background: "var(--mk-border)",
          borderRadius: 999,
          marginTop: "0.85rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${utilPct * 100}%`,
            height: "100%",
            background: tone,
            transition: "width 200ms",
          }}
        />
      </div>
      <div className="newdash-card-hint" style={{ marginTop: "0.35rem" }}>
        Using {PCT.format(utilization)} of paid subscription value — the rest is what you&rsquo;d be
        billed if every engineer were on metered API instead of the seat plan.
      </div>
    </div>
  );
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
}

function WeeklyThroughputBars({ data }: { data: schemas.WeeklyThroughputPoint[] }) {
  const maxVal = Math.max(1, ...data.map((w) => w.opened + w.merged));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.5rem" }}>
      {data.map((w) => (
        <div
          key={w.week}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.78rem" }}
        >
          <span style={{ width: "4.5rem", color: "var(--mk-ink-muted)" }}>{w.week}</span>
          <div style={{ flex: 1, display: "flex", gap: 2 }}>
            <div
              className="newdash-bar"
              style={{ width: `${(w.merged / maxVal) * 100}%`, background: "var(--mk-accent)" }}
              title={`${w.merged} merged`}
            />
            <div
              className="newdash-bar"
              style={{
                width: `${(Math.max(0, w.opened - w.merged) / maxVal) * 100}%`,
                background: "var(--mk-warm)",
                opacity: 0.7,
              }}
              title={`${Math.max(0, w.opened - w.merged)} still open or closed without merge`}
            />
          </div>
          <span style={{ width: "3rem", textAlign: "right" }}>
            {INT.format(w.merged)}/{INT.format(w.opened)}
          </span>
        </div>
      ))}
    </div>
  );
}
