import { expect, test } from "@playwright/test";

/**
 * First E2E flow: land on the summary, navigate to the sessions list, open a
 * session, click Reveal, submit a valid reason, and confirm the Server Action
 * surfaces the FORBIDDEN stub error (reveal's real body lands with Walid's
 * auth + Jorge's audit tables — see plan items B4 / M2 gate).
 */
test("dashboard → session → reveal → error → back", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Summary", level: 1 })).toBeVisible();

  const sidebar = page.getByRole("complementary", {
    name: "Primary navigation",
  });
  await sidebar.getByRole("link", { name: "Sessions", exact: true }).click();

  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByRole("heading", { name: "Sessions", level: 1 })).toBeVisible();

  const sessionsTable = page.getByRole("table", { name: "Sessions" });
  await expect(sessionsTable).toBeVisible();

  const firstRow = sessionsTable.locator('[role="row"][data-index="0"]');
  await expect(firstRow).toBeVisible();
  await firstRow.click();

  await expect(page).toHaveURL(/\/sessions\/[^/]+$/);
  await expect(page.getByText(/^Session ·/)).toBeVisible();

  await page.getByRole("button", { name: "Reveal prompt" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Reveal prompt text" })).toBeVisible();

  const submit = dialog.getByRole("button", { name: /^Reveal$/ });
  await expect(submit).toBeDisabled();

  const reason = "Investigating a suspected runaway loop on the infra task family.";
  await dialog.getByRole("textbox").fill(reason);
  await expect(submit).toBeEnabled();

  await submit.click();

  const alert = dialog.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/Reveal requires one of/i);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await page.goBack();
  await expect(page).toHaveURL(/\/sessions$/);
  await expect(page.getByRole("heading", { name: "Sessions", level: 1 })).toBeVisible();
});
