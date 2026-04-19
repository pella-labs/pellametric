// GitHub-integration boot-fail-closed gates (PRD §13 Phase G0 tests #3).
//
// The ingest server refuses to serve GitHub webhooks when any of the four
// mandatory dependencies is missing. Each failure mode surfaces a distinct
// `.code` string so dashboards / on-call alerting can pinpoint the exact
// misconfiguration without log grepping.
//
//   • BOOT_FAILED_GIT_EVENTS_STORE_MISSING        — gitEventsStore dep absent
//   • BOOT_FAILED_GITHUB_INSTALLATIONS_MISSING    — `github_installations`
//                                                   table not reachable /
//                                                   not migrated
//   • BOOT_FAILED_GITHUB_RECONCILER_MISSING       — reconciliation worker
//                                                   registration missing
//   • BOOT_FAILED_GITHUB_WEBHOOK_SECRET_MISSING   — no webhook-secret reference
//                                                   (secret resolver unwired)
//
// The checker is a pure-function boot gate: it throws `BootCheckFailedError`
// on failure with the code above, and resolves void on success. Deps flow in
// via explicit arguments so tests can mock each surface independently — NO
// database stubs; the `installationsTableProbe` is a callback the production
// code wires to a real `SELECT 1 FROM github_installations LIMIT 1` at boot.

import { describe, expect, test } from "bun:test";
import { assertGitHubBootDeps, BootCheckFailedError, type GitHubBootDeps } from "./bootCheck";

function okDeps(): GitHubBootDeps {
  return {
    gitEventsStore: { upsert: async () => ({ inserted: true }) },
    installationsTableProbe: async () => true,
    reconciler: { scheduled: true },
    webhookSecretRef: "vault://bematist/github/webhook-secret",
  };
}

describe("github-app bootCheck — fail-closed gates", () => {
  test("all deps present → resolves", async () => {
    await expect(assertGitHubBootDeps(okDeps())).resolves.toBeUndefined();
  });

  test("missing gitEventsStore → BOOT_FAILED_GIT_EVENTS_STORE_MISSING", async () => {
    const deps = okDeps();
    // biome-ignore lint/suspicious/noExplicitAny: deliberate misconfig
    (deps as any).gitEventsStore = undefined;
    let caught: unknown;
    try {
      await assertGitHubBootDeps(deps);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BootCheckFailedError);
    expect((caught as BootCheckFailedError).code).toBe("BOOT_FAILED_GIT_EVENTS_STORE_MISSING");
  });

  test("missing github_installations table → BOOT_FAILED_GITHUB_INSTALLATIONS_MISSING", async () => {
    const deps = okDeps();
    deps.installationsTableProbe = async () => false;
    let caught: unknown;
    try {
      await assertGitHubBootDeps(deps);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BootCheckFailedError);
    expect((caught as BootCheckFailedError).code).toBe("BOOT_FAILED_GITHUB_INSTALLATIONS_MISSING");
  });

  test("probe throws → also surfaces BOOT_FAILED_GITHUB_INSTALLATIONS_MISSING", async () => {
    const deps = okDeps();
    deps.installationsTableProbe = async () => {
      throw new Error("relation github_installations does not exist");
    };
    let caught: unknown;
    try {
      await assertGitHubBootDeps(deps);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BootCheckFailedError);
    expect((caught as BootCheckFailedError).code).toBe("BOOT_FAILED_GITHUB_INSTALLATIONS_MISSING");
  });

  test("missing reconciler → BOOT_FAILED_GITHUB_RECONCILER_MISSING", async () => {
    const deps = okDeps();
    // biome-ignore lint/suspicious/noExplicitAny: deliberate misconfig
    (deps as any).reconciler = undefined;
    let caught: unknown;
    try {
      await assertGitHubBootDeps(deps);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BootCheckFailedError);
    expect((caught as BootCheckFailedError).code).toBe("BOOT_FAILED_GITHUB_RECONCILER_MISSING");
  });

  test("reconciler present but unscheduled → BOOT_FAILED_GITHUB_RECONCILER_MISSING", async () => {
    const deps = okDeps();
    deps.reconciler = { scheduled: false };
    let caught: unknown;
    try {
      await assertGitHubBootDeps(deps);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BootCheckFailedError);
    expect((caught as BootCheckFailedError).code).toBe("BOOT_FAILED_GITHUB_RECONCILER_MISSING");
  });

  test("missing webhookSecretRef → BOOT_FAILED_GITHUB_WEBHOOK_SECRET_MISSING", async () => {
    const deps = okDeps();
    deps.webhookSecretRef = "";
    let caught: unknown;
    try {
      await assertGitHubBootDeps(deps);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BootCheckFailedError);
    expect((caught as BootCheckFailedError).code).toBe("BOOT_FAILED_GITHUB_WEBHOOK_SECRET_MISSING");
  });

  test("undefined webhookSecretRef → BOOT_FAILED_GITHUB_WEBHOOK_SECRET_MISSING", async () => {
    const deps = okDeps();
    // biome-ignore lint/suspicious/noExplicitAny: deliberate misconfig
    (deps as any).webhookSecretRef = undefined;
    let caught: unknown;
    try {
      await assertGitHubBootDeps(deps);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BootCheckFailedError);
    expect((caught as BootCheckFailedError).code).toBe("BOOT_FAILED_GITHUB_WEBHOOK_SECRET_MISSING");
  });

  test("each error code is distinct", () => {
    const codes = new Set([
      "BOOT_FAILED_GIT_EVENTS_STORE_MISSING",
      "BOOT_FAILED_GITHUB_INSTALLATIONS_MISSING",
      "BOOT_FAILED_GITHUB_RECONCILER_MISSING",
      "BOOT_FAILED_GITHUB_WEBHOOK_SECRET_MISSING",
    ]);
    expect(codes.size).toBe(4);
  });
});
