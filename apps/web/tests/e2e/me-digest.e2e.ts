import { expect, test } from "@playwright/test";

/**
 * `/me/digest` transparency-log invariants:
 *   - h1 "My digest" renders (the personal view of who has opened your
 *     surfaces).
 *   - The page shows the current notification preference (default
 *     "daily digest") with the opt-out copy visible in the header.
 *   - The empty-state copy is load-bearing for M1 — no audit events yet —
 *     but the framing still has to communicate that transparency is the
 *     default, not a premium feature.
 *
 * Note: today only the preference BADGE renders, not a live toggle. When
 * Walid's notification-preference mutation lands, extend this spec to click
 * the toggle and assert the server action response.
 */

test.describe("/me/digest", () => {
  test("renders with notification preference + opt-out transparency copy", async ({
    page,
  }) => {
    await page.goto("/me/digest");

    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { name: "My digest", level: 1 }),
    ).toBeVisible();

    // Opt-out framing is the load-bearing copy — transparency default, never
    // a paid feature.
    await expect(
      main.getByText(/transparency is the\s+default, never a paid feature/i),
    ).toBeVisible();

    // Notification preference surfaces as the literal string "Preference:"
    // followed by a badge with the current setting (default "daily digest").
    await expect(main.getByText(/Preference:/i)).toBeVisible();
    await expect(main.getByText("daily digest", { exact: true })).toBeVisible();

    // Recent-views card is present even with zero events — the empty state
    // is the realistic M1 shape.
    await expect(
      main.getByRole("heading", { name: "Recent views" }),
    ).toBeVisible();
    await expect(
      main.getByText(/Nothing in the last 24 hours/i),
    ).toBeVisible();
  });
});
