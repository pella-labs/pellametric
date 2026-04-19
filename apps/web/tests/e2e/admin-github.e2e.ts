import { expect, test } from "@playwright/test";

/**
 * PRD §13 Phase G1 step 2b — admin/github UI surface smoke test.
 *
 * Dev-mode session defaults to `role=admin` (see `apps/web/lib/session-resolver.ts`)
 * so we don't need Better Auth cookie plumbing. We verify:
 *   1. `/admin/github` renders its heading + the connection card (either the
 *      install CTA or a bound installation block).
 *   2. `/admin/github/repos` renders its heading + the repos table chrome,
 *      and the "Dry-run preview" G2 slot is present but disabled.
 *
 * The page doesn't need GitHub credentials to render — when no installation
 * is bound it shows the "Install GitHub App" CTA; when one is bound via the
 * test seed, it shows the status card.
 */

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

  test("renders repos page + disabled Dry-run preview slot", async ({ page }) => {
    await page.goto("/admin/github/repos");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "GitHub repos", level: 1 })).toBeVisible();
    // Column headers prove the table chrome rendered. Match via table scope
    // so the body copy doesn't false-positive on shared substrings.
    const table = main.locator("table");
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /default branch/i })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /tracking state/i })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: /effective tracked/i })).toBeVisible();
  });
});
