import { expect, test } from "@playwright/test";

/**
 * `/insights` weekly digest invariants:
 *   - h1 renders.
 *   - No "Low" confidence insight is surfaced — low-confidence entries are
 *     dropped server-side by `filterByConfidence`. The digest banner may say
 *     "N low-confidence · not shown", but no insight card may carry a "Low"
 *     badge.
 *   - Medium-confidence insights carry the "Investigate" label (from
 *     ConfidenceBadge's labels map).
 *   - High-confidence insights render their "High" label.
 */

test.describe("/insights", () => {
  test("drops low-confidence, labels medium 'Investigate', keeps high", async ({
    page,
  }) => {
    await page.goto("/insights");

    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { name: "Insights", level: 1 }),
    ).toBeVisible();

    // The <ol aria-label="Weekly insights"> holds every rendered insight card.
    const list = main.locator('ol[aria-label="Weekly insights"]');
    await expect(list).toBeVisible();

    // High-confidence badges render as `aria-label="Confidence: High"`.
    const highBadges = list.locator('[aria-label="Confidence: High"]');
    await expect(highBadges.first()).toBeVisible();
    expect(await highBadges.count()).toBeGreaterThanOrEqual(1);

    // Medium-confidence badges render with label "Investigate" AND
    // aria-label="Confidence: Investigate" (the ConfidenceBadge maps
    // `medium` → "Investigate").
    const mediumBadges = list.locator(
      '[aria-label="Confidence: Investigate"]',
    );
    await expect(mediumBadges.first()).toBeVisible();
    await expect(mediumBadges.first()).toHaveText("Investigate");

    // The "Low" confidence tier MUST NOT render — the server drops it.
    const lowBadges = list.locator('[aria-label="Confidence: Low"]');
    await expect(lowBadges).toHaveCount(0);

    // And no insight card title text references the suppressed fixture.
    await expect(
      list.getByText("Potential autonomy regression", { exact: false }),
    ).toHaveCount(0);
  });
});
