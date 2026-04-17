import { expect, test } from "@playwright/test";

/**
 * `/teams` privacy + display-gate invariants:
 *   - The 2×2 scatter is the core view. IC names are always hidden —
 *     Teams surface must render scatter DOTS ONLY in chart mode (no monospace
 *     engineer-id hash leaks into the visible text).
 *   - When a below-cohort team is selected (`team_ml`, cohort=4 < 5 floor),
 *     the scatter is suppressed and the `InsufficientData` copy names the
 *     failed gate (k≥5).
 */

test.describe("/teams", () => {
  test("2×2 scatter view hides IC identifiers by default", async ({ page }) => {
    await page.goto("/teams");

    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Teams", level: 1 })).toBeVisible();

    // Header sub-copy restates the invariant — a load-bearing contract string.
    await expect(main.getByText(/IC names are always hidden/i)).toBeVisible();

    // 2×2 block heading is present — the chart renders as role="img" with an
    // aria-label naming the selected team, not engineers.
    await expect(main.getByRole("img", { name: /2×2 scatter for /i })).toBeVisible();

    // In chart mode (default), no scatter-table row exists — the stable
    // 8-hex engineer_id_hash only appears inside the table toggle. The
    // <table> with the "Engineer" column header must NOT be present until
    // the user explicitly flips to table mode.
    const engineerCols = main.getByRole("columnheader", {
      name: "Engineer",
      exact: true,
    });
    await expect(engineerCols).toHaveCount(0);

    // The scatter table also renders engineer-id hashes in monospace td cells.
    // Those cells use `font-mono` — assert no `.font-mono` content inside
    // main matches a raw 8-hex hash pattern (Playwright's getByText with a
    // regex matches full trimmed text content on a single element, so this
    // is the engineer_id_hash leak canary).
    const monoCells = main.locator("td.font-mono");
    await expect(monoCells).toHaveCount(0);
  });

  test("below-cohort team renders InsufficientData with named gate", async ({ page }) => {
    // team_ml has 4 engineers — under the k≥5 floor, the 2×2 must suppress.
    await page.goto("/teams?team=team_ml");

    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Teams", level: 1 })).toBeVisible();

    // The InsufficientData component announces the k-anonymity gate name and
    // the team's actual cohort size. Both must be visible.
    await expect(
      main.getByText(/Insufficient cohort — k=4 is below the 5-person floor/i),
    ).toBeVisible();

    // And the scatter chart must NOT render — no role="img" 2×2 scatter.
    const scatter = main.getByRole("img", { name: /2×2 scatter for /i });
    await expect(scatter).toHaveCount(0);
  });
});
