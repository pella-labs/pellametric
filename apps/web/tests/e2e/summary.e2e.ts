import { expect, test } from "@playwright/test";

/**
 * `/` Summary surface privacy + a11y invariants:
 *   - h1 "Summary" renders.
 *   - 3 KPI cards (Total cost · Accepted edits · AI Leverage Score) render in main.
 *   - Cost chart has the a11y "View as table" toggle — pressing it swaps the
 *     chart for a real `<table>` (Design Rules: every chart has a table view).
 *   - Reduced-motion fallback: the page still renders under
 *     `prefers-reduced-motion: reduce`.
 */

test.describe("/ summary", () => {
  test("renders h1, 3 KPI cards, and chart↔table toggle", async ({ page }) => {
    await page.goto("/");

    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { name: "Summary", level: 1 }),
    ).toBeVisible();

    // Three KPI cards are the contract — titles are stable strings.
    await expect(main.getByText("Total cost", { exact: true })).toBeVisible();
    await expect(
      main.getByText("Accepted edits", { exact: true }),
    ).toBeVisible();
    await expect(
      main.getByText("AI Leverage Score", { exact: true }),
    ).toBeVisible();

    // The cost-per-day card renders its chart in chart mode by default. The
    // toggle flips to a real <table>. The button's accessible name comes
    // from its inner span (`aria-labelledby`) — "View as table" when we're
    // in chart mode.
    const toggle = main.getByRole("button", { name: "View as table" });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    // Table is not yet rendered.
    await expect(main.locator("table")).toHaveCount(0);

    await toggle.click();

    // After toggle, the same button relabels itself to "View as chart" and
    // aria-pressed flips to true.
    const chartToggle = main.getByRole("button", { name: "View as chart" });
    await expect(chartToggle).toBeVisible();
    await expect(chartToggle).toHaveAttribute("aria-pressed", "true");
    const table = main.locator("table");
    await expect(table).toHaveCount(1);
    await expect(table).toBeVisible();
    // The cost-series table ships with "Date" and "Cost" headers.
    await expect(
      table.getByRole("columnheader", { name: "Date" }),
    ).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "Cost" }),
    ).toBeVisible();
  });

  test("renders under prefers-reduced-motion: reduce", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { name: "Summary", level: 1 }),
    ).toBeVisible();
    await expect(main.getByText("Total cost", { exact: true })).toBeVisible();
  });
});
