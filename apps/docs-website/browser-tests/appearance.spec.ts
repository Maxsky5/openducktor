import type { Page } from "@playwright/test";
import { expect, isPhone, openNavigation, selectPage, test } from "./fixtures";

function isDark(page: Page) {
  return page.evaluate(() => document.documentElement.classList.contains("dark"));
}

/** Stops the framework scripts, so the page shows the markup and the styles of the export only. */
function blockScripts(page: Page) {
  return page.route("**/_next/static/chunks/*.js", (route) => route.abort());
}

/** The places of the header buttons that need scripts. */
function headerButtons(page: Page) {
  return page
    .locator("header [data-requires-script]")
    .filter({ visible: true })
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const { x, y, width, height } = button.getBoundingClientRect();
        return { label: button.getAttribute("aria-label"), x, y, width, height };
      }),
    );
}

test("the page starts with the system appearance and keeps a choice during the visit", async ({
  page,
}, testInfo) => {
  const systemDark = testInfo.project.name.endsWith("dark");
  await page.goto("/install-and-update/");
  expect(await isDark(page)).toBe(systemDark);

  await openNavigation(page);
  await page.getByRole("button", { name: "Dark appearance" }).filter({ visible: true }).click();
  expect(await isDark(page)).toBe(!systemDark);

  await selectPage(page, "Mobile");
  await expect(page).toHaveURL("/mobile/");
  expect(await isDark(page)).toBe(!systemDark);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);

  await page.reload();
  expect(await isDark(page)).toBe(systemDark);
});

test("the page has the system appearance before its scripts run", async ({ page }, testInfo) => {
  const systemDark = testInfo.project.name.endsWith("dark");
  await blockScripts(page);
  await page.goto("/install-and-update/");
  expect(await isDark(page)).toBe(systemDark);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
    systemDark ? "dark" : "light",
  );
});

test("the header buttons keep their places when the page hydrates", async ({ page }) => {
  test.skip(isPhone(page), "A narrow header keeps these buttons in the menu.");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await blockScripts(page);
  await page.goto("/install-and-update/");
  const before = await headerButtons(page);
  expect(before.map((button) => button.label)).toEqual(["Pause animations", "Dark appearance"]);

  await page.unrouteAll();
  await page.reload();
  // The pause control gets its pressed state when it binds to the scenes.
  await expect(page.locator("header .docs-motion-control")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(await headerButtons(page)).toEqual(before);
});
