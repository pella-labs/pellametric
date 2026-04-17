/**
 * Per-org embedding cost guard. Contract 05 §Cost guardrails.
 * Default $20/org/day on managed cloud. Soft alert at 50%; hard stop at 100%.
 * In-memory daily rollover — production wires a Redis-backed counter
 * keyed on (org_id, YYYY-MM-DD).
 */

export class BudgetExceededError extends Error {
  constructor(orgId: string, spent: number, budget: number) {
    super(
      `embed budget exceeded for org ${orgId}: spent $${spent.toFixed(4)} / $${budget.toFixed(2)}`,
    );
    this.name = "BudgetExceededError";
  }
}

export interface CostGuardOpts {
  /** USD per day per org. Default $20. */
  dailyBudgetUsd?: number;
  /** Soft-alert threshold (0-1). Default 0.5. */
  softAlertFraction?: number;
  /** Optional callback when soft threshold crossed. */
  onSoftAlert?: (orgId: string, spent: number, budget: number) => void;
}

export class CostGuard {
  private readonly dailyBudgetUsd: number;
  private readonly softAlertFraction: number;
  private readonly onSoftAlert?: (org: string, spent: number, budget: number) => void;
  private readonly spend = new Map<string, number>(); // key: `${orgId}:${YYYY-MM-DD}`
  private readonly softFired = new Set<string>();

  constructor(opts: CostGuardOpts = {}) {
    this.dailyBudgetUsd = opts.dailyBudgetUsd ?? 20;
    this.softAlertFraction = opts.softAlertFraction ?? 0.5;
    if (opts.onSoftAlert) this.onSoftAlert = opts.onSoftAlert;
  }

  private dayKey(orgId: string, when: Date = new Date()): string {
    const y = when.getUTCFullYear();
    const m = String(when.getUTCMonth() + 1).padStart(2, "0");
    const d = String(when.getUTCDate()).padStart(2, "0");
    return `${orgId}:${y}-${m}-${d}`;
  }

  /** Throws BudgetExceededError if registering this cost would exceed budget. */
  register(orgId: string, costUsd: number, when?: Date): void {
    const key = this.dayKey(orgId, when);
    const before = this.spend.get(key) ?? 0;
    const after = before + costUsd;
    if (after > this.dailyBudgetUsd) {
      throw new BudgetExceededError(orgId, after, this.dailyBudgetUsd);
    }
    this.spend.set(key, after);
    const softThreshold = this.dailyBudgetUsd * this.softAlertFraction;
    if (after >= softThreshold && !this.softFired.has(key)) {
      this.softFired.add(key);
      this.onSoftAlert?.(orgId, after, this.dailyBudgetUsd);
    }
  }

  /** Current USD spend for this org today. */
  spent(orgId: string, when?: Date): number {
    return this.spend.get(this.dayKey(orgId, when)) ?? 0;
  }

  /** Reset all counters — useful in tests + midnight rollover. */
  reset(): void {
    this.spend.clear();
    this.softFired.clear();
  }
}
