import { links } from "../src/content/site";
import { expect, installs, steps, test } from "./fixtures";

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("every step, install method, and answer stays readable", async ({ page }) => {
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.locator("[data-theme-toggle]")).toBeHidden();
    // The opening, the four install terminals, and the closing each have one.
    await expect(page.locator("[data-command] button")).toHaveCount(6);
    for (const button of await page.locator("[data-command] button").all()) {
      await expect(button).toBeHidden();
    }
    for (const id of steps) {
      await expect(page.locator(`#workflow-panel-${id} .chapter-heading`)).toBeVisible();
      await expect(page.locator(`#workflow-panel-${id} [data-stage]`)).toBeVisible();
    }
    for (const [id, title, , command] of installs) {
      await expect(page.locator(`#install-${id}`)).toHaveText(title);
      await expect(
        page.getByRole("article", { name: title, exact: true }).locator(".t-input code"),
      ).toHaveText(command);
    }
    await expect(page.locator("[data-install] .t-log")).toHaveCount(7);
    await expect(page.locator('[data-scene="local"] .diag-badge').last()).toHaveText("Ready");
    const question = page.locator(".faq-answers details").first();
    await question.locator("summary").click();
    await expect(question.locator("p")).toBeVisible();
    await expect(
      page.locator(".hero").getByRole("link", { name: "Download", exact: true }),
    ).toHaveAttribute("href", links.latest);
  });
});
