// GitHub-integration boot-fail-closed checker (PRD §13 Phase G0).
//
// Refuses to bring the ingest server up when any mandatory GitHub-integration
// dependency is missing. Surfaces four distinct error codes so on-call can
// pinpoint the exact misconfiguration without log grepping:
//
//   • BOOT_FAILED_GIT_EVENTS_STORE_MISSING      — gitEventsStore dep absent.
//   • BOOT_FAILED_GITHUB_INSTALLATIONS_MISSING  — `github_installations`
//                                                 table not reachable.
//   • BOOT_FAILED_GITHUB_RECONCILER_MISSING     — reconciliation worker
//                                                 registration missing.
//   • BOOT_FAILED_GITHUB_WEBHOOK_SECRET_MISSING — webhook-secret reference
//                                                 is empty / unwired.
//
// The checker is a pure function over an explicit deps struct. Callers wire
// the `installationsTableProbe` to a real `SELECT 1 FROM github_installations
// LIMIT 1` against the control-plane Postgres at boot. If the probe throws
// OR returns false, we treat the dep as missing (fail closed — no way to
// distinguish "table absent" from "unreachable" mid-boot anyway, and either
// is a refusal-to-serve condition).
//
// H3 — apps/ingest/src/index.ts now enforces the GITHUB_APP_ID subset of
// this contract at startup with process.exit(1). The full structural check
// (installations probe + reconciler signal + webhook secret ref) runs via
// `assertGitHubBootDeps` when wired by the service orchestrator; tests
// call it directly. Any failure yields BOOT_FAILED_* + FATAL severity.

export type GitHubBootErrorCode =
  | "BOOT_FAILED_GIT_EVENTS_STORE_MISSING"
  | "BOOT_FAILED_GITHUB_INSTALLATIONS_MISSING"
  | "BOOT_FAILED_GITHUB_RECONCILER_MISSING"
  | "BOOT_FAILED_GITHUB_WEBHOOK_SECRET_MISSING"
  | "BOOT_FAILED_GITHUB_APP_ID_MISSING";

export class BootCheckFailedError extends Error {
  readonly code: GitHubBootErrorCode;
  constructor(code: GitHubBootErrorCode, message: string) {
    super(message);
    this.name = "BootCheckFailedError";
    this.code = code;
  }
}

/**
 * Minimal shape of the dependencies the GitHub-integration ingest path needs
 * at boot. Deliberately narrow — each surface is validated independently so
 * the emitted error code pinpoints exactly one missing piece.
 */
export interface GitHubBootDeps {
  /**
   * Persistence surface for parsed webhook rows (mirror of the in-memory
   * `GitEventsStore` — Postgres-backed in production).
   */
  gitEventsStore:
    | {
        upsert: (...args: unknown[]) => Promise<{ inserted: boolean }> | { inserted: boolean };
      }
    | undefined;
  /**
   * Cheap liveness probe against the `github_installations` table. Resolves
   * `true` when the row is reachable; `false` OR throw → treat as missing.
   */
  installationsTableProbe: () => Promise<boolean>;
  /**
   * Reconciliation worker registration signal. In G1 this becomes a PgBoss
   * scheduled-job check; for G0 it's a structural flag callers set once the
   * reconciliation cron has been wired.
   */
  reconciler: { scheduled: boolean } | undefined;
  /**
   * Non-empty reference pointing at the active webhook secret in the secrets
   * store (the actual secret never transits this struct). Empty string OR
   * undefined → BOOT_FAILED_GITHUB_WEBHOOK_SECRET_MISSING.
   */
  webhookSecretRef: string | undefined;
}

/**
 * Assert the GitHub-integration boot dependencies are present.
 *
 * @throws {BootCheckFailedError} with `.code` set to one of the four
 * `BOOT_FAILED_*` codes when any dep is missing. The order below matches the
 * severity/diagnostic ordering we want in logs: store → table → reconciler →
 * secret. Each check short-circuits — we surface ONE precise reason, not a
 * composite.
 */
export async function assertGitHubBootDeps(deps: GitHubBootDeps): Promise<void> {
  if (!deps.gitEventsStore || typeof deps.gitEventsStore.upsert !== "function") {
    throw new BootCheckFailedError(
      "BOOT_FAILED_GIT_EVENTS_STORE_MISSING",
      "github: gitEventsStore dep is missing or has no upsert() — refusing to serve webhooks.",
    );
  }

  let probeOk = false;
  try {
    probeOk = await deps.installationsTableProbe();
  } catch (err) {
    throw new BootCheckFailedError(
      "BOOT_FAILED_GITHUB_INSTALLATIONS_MISSING",
      `github: installations probe threw (${err instanceof Error ? err.message : String(err)}) — refusing to serve webhooks.`,
    );
  }
  if (!probeOk) {
    throw new BootCheckFailedError(
      "BOOT_FAILED_GITHUB_INSTALLATIONS_MISSING",
      "github: `github_installations` table not reachable — refusing to serve webhooks.",
    );
  }

  if (!deps.reconciler || deps.reconciler.scheduled !== true) {
    throw new BootCheckFailedError(
      "BOOT_FAILED_GITHUB_RECONCILER_MISSING",
      "github: reconciliation worker not registered — refusing to serve webhooks.",
    );
  }

  if (typeof deps.webhookSecretRef !== "string" || deps.webhookSecretRef.length === 0) {
    throw new BootCheckFailedError(
      "BOOT_FAILED_GITHUB_WEBHOOK_SECRET_MISSING",
      "github: webhookSecretRef is empty — refusing to serve webhooks.",
    );
  }
}
