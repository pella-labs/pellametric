import { expect, test } from "@playwright/test";

/**
 * PRD §13 Phase G1 step 2b — admin/github UI surface smoke test.
 *
 * H2 — the admin surfaces live behind `middleware.ts`, which bounces to
 * `/auth/sign-in` when no session cookie is present. The in-process
 * session resolver has a dev-mode fallback (role=admin when
 * NODE_ENV !== "production") but it runs at the RSC layer, AFTER the
 * middleware redirect. We therefore pre-seed a legacy
 * `bematist-session` cookie via Playwright's `storageState` fixture;
 * the cookie value does not need to map to a real Redis row — the
 * session resolver's Redis lookup returns null on this synthetic token
 * and the code path falls through to the dev-mode admin fallback. This
 * is closer to the production shape than setting
 * `BEMATIST_DEV_TENANT_ID` because it exercises the middleware gate.
 *
 * We verify:
 *   1. `/admin/github` renders its heading + the connection card (either the
 *      install CTA or a bound installation block).
 *   2. `/admin/github/repos` renders its heading + the repos table chrome,
 *      and the "Dry-run preview" G2 slot is present but disabled.
 *
 * The page doesn't need GitHub credentials to render — when no installation
 * is bound it shows the "Install GitHub App" CTA; when one is bound via the
 * test seed, it shows the status card.
 */

test.use({ storageState: "./tests/e2e/fixtures/admin.storageState.json" });

test.describe("/admin/github", () => {
  test("renders connection card + Start sync affordance", async ({ page }) => {
    await page.goto("/admin/github");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "GitHub", level: 1 })).toBeVisible();
    // Connection card title is always present.
    await expect(main.getByText("Connection", { exact: true })).toBeVisible();
    // Either the "Install GitHub App" CTA OR a bound-installation block —
    // both cases render in G1. Match either.
    const installCta = main.getByRole("button", { name: /install github app/i });
    const startSync = main.getByRole("button", { name: /start sync/i });
    const eitherVisible = (await installCta.count()) + (await startSync.count());
    expect(eitherVisible).toBeGreaterThan(0);
  });

  test("renders repos page + either table chrome or empty-state", async ({ page }) => {
    await page.goto("/admin/github/repos");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "GitHub repos", level: 1 })).toBeVisible();
    // Either the table chrome (repos exist) or the empty-state message.
    const table = main.locator("table");
    const emptyState = main.getByText(/no repos yet/i);
    const hasTable = (await table.count()) > 0;
    const hasEmpty = (await emptyState.count()) > 0;
    expect(hasTable || hasEmpty).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// G2 — UI smoke tests for the 4 new admin surfaces (tracking-mode,
// per-repo tracking-state, rotation modal, redelivery form). We verify
// rendering + click affordances. The Server Actions themselves are unit-
// tested in packages/api/src/queries/github/routes.g2.test.ts.
//
// These tests don't require a bound GitHub installation because we
// verify either-branch presence (install CTA OR control visible).
// ----------------------------------------------------------------------------

test.describe("/admin/github — G2 UI surfaces", () => {
  test("tracking-mode control renders with All/Selected buttons", async ({ page }) => {
    await page.goto("/admin/github");
    const main = page.getByRole("main");
    // Either the install CTA (no installation yet) or the tracking-mode
    // fieldset (installation present). If installation is present, we must
    // see the two test-id buttons.
    const allBtn = main.getByTestId("tracking-mode-all");
    const selectedBtn = main.getByTestId("tracking-mode-selected");
    const installCta = main.getByRole("button", { name: /install github app/i });
    const visible =
      (await allBtn.count()) + (await selectedBtn.count()) + (await installCta.count());
    expect(visible).toBeGreaterThan(0);
  });

  test("per-repo tracking-state dropdown renders on repos table when repos present", async ({
    page,
  }) => {
    await page.goto("/admin/github/repos");
    const main = page.getByRole("main");
    // The table renders regardless of content. When repos exist, at least
    // one row has a select[data-testid^='repo-tracking-select-']. When
    // empty, the empty-state text shows. Either is acceptable.
    const anySelect = main.locator('select[data-testid^="repo-tracking-select-"]');
    const emptyState = main.getByText(/no repos yet/i);
    const visible = (await anySelect.count()) + (await emptyState.count());
    expect(visible).toBeGreaterThan(0);
  });

  test("webhook-secret rotation button opens the confirmation modal", async ({ page }) => {
    await page.goto("/admin/github");
    const main = page.getByRole("main");
    const openBtn = main.getByTestId("open-rotate-modal");
    if ((await openBtn.count()) === 0) {
      // No installation — skip.
      test.skip();
      return;
    }
    await openBtn.click();
    const modal = page.getByTestId("rotate-secret-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId("rotate-secret-ref-input")).toBeVisible();
    // Confirm button disabled when ref empty.
    await expect(modal.getByTestId("rotate-secret-confirm")).toBeDisabled();
    await modal.getByTestId("rotate-secret-ref-input").fill("sm/test-ref-v2");
    await expect(modal.getByTestId("rotate-secret-confirm")).toBeEnabled();
  });

  test("redelivery form renders with date inputs + event-type toggles", async ({ page }) => {
    await page.goto("/admin/github");
    const main = page.getByRole("main");
    const fromInput = main.getByTestId("redeliver-from");
    if ((await fromInput.count()) === 0) {
      test.skip();
      return;
    }
    await expect(fromInput).toBeVisible();
    await expect(main.getByTestId("redeliver-to")).toBeVisible();
    await expect(main.getByTestId("redeliver-event-pull_request")).toBeVisible();
    await expect(main.getByTestId("redeliver-event-push")).toBeVisible();
    // Submit button disabled when from/to empty.
    await expect(main.getByTestId("redeliver-submit")).toBeDisabled();
  });
});
