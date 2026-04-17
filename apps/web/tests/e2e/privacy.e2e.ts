import { expect, test } from "@playwright/test";

/**
 * `/privacy` — the Bematist Bill of Rights page. It's the canonical user-facing
 * statement of the six privacy guarantees we actually enforce in code. If this
 * page drifts from the six rules, someone has shipped a policy change without
 * the corresponding UI update — this spec blocks that.
 *
 * Version label is pinned to `v1` for today; the spec asserts the version
 * element so any wording change lands with a deliberate version bump.
 */

test.describe("/privacy (Bill of Rights)", () => {
  test("v1 Bill of Rights renders all six items with load-bearing copy", async ({
    page,
  }) => {
    await page.goto("/privacy");

    // /privacy is OUTSIDE the dashboard layout — it ships its own <main>.
    const main = page.getByRole("main");

    await expect(
      main.getByRole("heading", {
        name: "What we promise every engineer",
        level: 1,
      }),
    ).toBeVisible();

    // Version pin — the page sets data-version="v1" on the visible version
    // chip. Assert both the attribute and the visible text so a silent
    // wording revision does not slip by.
    const versionChip = main.locator('[data-version="v1"]');
    await expect(versionChip).toBeVisible();
    await expect(versionChip).toHaveText("v1");

    // The six item titles (stable keys — bill-of-rights.ts `title` fields).
    await expect(
      main.getByRole("heading", {
        name: "Prompts never leave your machine without a banner",
      }),
    ).toBeVisible();
    await expect(
      main.getByRole("heading", {
        name: "Managers cannot read your prompt text",
      }),
    ).toBeVisible();
    await expect(
      main.getByRole("heading", { name: "7-day export and erasure" }),
    ).toBeVisible();
    await expect(
      main.getByRole("heading", {
        name: "Counters and redacted envelopes by default",
      }),
    ).toBeVisible();
    await expect(
      main.getByRole("heading", { name: "Every access is logged" }),
    ).toBeVisible();
    await expect(
      main.getByRole("heading", { name: "You are told when a manager looks" }),
    ).toBeVisible();

    // Load-bearing body phrases from CLAUDE.md Privacy Model Rules — asserting
    // the exact surface wording keeps the legal commitment visible.
    // Rule: managers read prompts only under three named conditions.
    await expect(
      main.getByText(
        /three named, audit-logged conditions/i,
      ),
    ).toBeVisible();
    // Rule: 7-day GDPR export + erasure, dropping the ClickHouse partition.
    await expect(
      main.getByText(/export or delete your data within 7 days/i),
    ).toBeVisible();
    await expect(
      main.getByText(/drops the underlying ClickHouse partition/i),
    ).toBeVisible();
    // Rule: Tier B counters + envelopes is the default, Tier C is opt-in.
    await expect(
      main.getByText(
        /Tier B \(counters \+ server-redacted envelopes\) is the default/i,
      ),
    ).toBeVisible();
    await expect(
      main.getByText(/Tier C \(full prompt text\) is explicit opt-in/i),
    ).toBeVisible();

    // Exactly six items in the ordered list. The body uses a single <ol>
    // with one <li> per rule — count asserts we did not silently add/drop.
    const items = main.locator("ol > li");
    await expect(items).toHaveCount(6);
  });
});
