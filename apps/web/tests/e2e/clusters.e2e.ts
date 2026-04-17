import { expect, test } from "@playwright/test";

/**
 * `/clusters` Twin Finder privacy invariants:
 *   - Page h1 renders.
 *   - Every surfaced cluster shows `N contributors` copy with N >= 3
 *     (k-anonymity contributor floor; below floor is computed but never
 *     surfaced).
 *   - The header sub-copy restates the k≥3 rule so operators know why a
 *     sparse section looks sparse.
 */

test.describe("/clusters", () => {
  test("renders and every visible cluster meets the k≥3 contributor floor", async ({
    page,
  }) => {
    await page.goto("/clusters");

    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { name: "Clusters", level: 1 }),
    ).toBeVisible();

    // Header sub-copy restates the invariant.
    await expect(main.getByText(/k≥3 contributor floor/i)).toBeVisible();

    // The cluster section uses aria-label="Cluster list". Collect all
    // "N contributors" text fragments inside it; every number MUST be >= 3.
    const clusterList = main.locator('section[aria-label="Cluster list"]');
    await expect(clusterList).toBeVisible();

    // Wait for at least one cluster card to render. Fixture data seeds enough
    // clusters to pass the floor in the dev tenant.
    const cardHeaders = clusterList.locator("text=/\\d+ contributors/");
    await expect(cardHeaders.first()).toBeVisible();

    const count = await cardHeaders.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const text = (await cardHeaders.nth(i).textContent()) ?? "";
      const match = text.match(/(\d+)\s+contributors/);
      expect(
        match,
        `cluster card ${i}: expected "N contributors" copy, got ${JSON.stringify(text)}`,
      ).not.toBeNull();
      const contributors = Number(match?.[1] ?? 0);
      expect(
        contributors,
        `cluster card ${i} has ${contributors} contributors — below k=3 floor`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
