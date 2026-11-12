import { documentKept, expect, markDocument, test } from "./fixtures";

async function openSearch(page: import("@playwright/test").Page) {
  const trigger = page
    .locator("[data-search], [data-search-full]")
    .filter({ visible: true })
    .first();
  // The page marks its root when it responds to input.
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await trigger.click();
  return trigger;
}

test("search finds published content in the browser and opens the result", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto("/");
  await markDocument(page);
  const trigger = await openSearch(page);
  const input = page.getByRole("combobox", { name: "Search" });
  await input.fill("harness");
  const results = page.getByRole("option");
  await expect(results.first()).toBeVisible();
  expect(requests).toContain("/search-index.json");
  expect(requests.some((path) => path.startsWith("/api/"))).toBe(false);

  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  await openSearch(page);
  await input.fill("Diagnostics");
  await expect(results.first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("#docs-title")).toBeVisible();
  expect(await documentKept(page)).toBe(true);
});

test("search reads a lane pill as the title of its lane", async ({ page }) => {
  await page.goto("/");
  await openSearch(page);
  await page.getByRole("combobox", { name: "Search" }).fill("board shows a task in Done");
  await expect(
    page.getByRole("option").filter({ hasText: "The board shows a task in Done for 1 day" }),
  ).not.toHaveCount(0);
});

test("a failed index load keeps the query and offers a retry", async ({ page }) => {
  await page.route("**/search-index.json*", (route) => route.abort());
  await page.goto("/");
  await openSearch(page);
  const input = page.getByRole("combobox", { name: "Search" });
  await input.fill("harness");
  await expect(page.getByText("The search index did not load.")).toBeVisible();
  await expect(page.getByText("No pages match this search.")).toBeHidden();

  await page.unroute("**/search-index.json*");
  await page.getByRole("button", { name: "Retry search" }).click();
  await expect(page.getByRole("option").first()).toBeVisible();
  await expect(input).toHaveValue("harness");
});

test("a query without matches says so", async ({ page }) => {
  await page.goto("/");
  await openSearch(page);
  await page.getByRole("combobox", { name: "Search" }).fill("qqzzxxwy");
  await expect(page.getByText("No pages match this search.")).toBeVisible();
});

test("a result on the current page moves focus to its section", async ({ page }) => {
  await page.goto("/autopilot/");
  await openSearch(page);
  await page.getByRole("combobox", { name: "Search" }).fill("Turn on rules");
  const result = page.getByRole("option").filter({ hasText: "Turn on rules" }).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(/\/autopilot\/#/);
  const focused = await page.evaluate(() => document.activeElement?.id ?? "");
  expect(focused).not.toBe("");
  await expect(page.locator(`[id="${focused}"]`)).toBeInViewport();
});

test("a result in a closed accordion on the current page opens it", async ({ page }) => {
  await page.goto("/tasks-and-workflows/");
  const header = page.locator("#remove-worktree");
  await expect(header).toHaveAttribute("data-state", "closed");
  await openSearch(page);
  await page.getByRole("combobox", { name: "Search" }).fill("Remove Worktree");
  const result = page.getByRole("option").filter({ hasText: "Remove Worktree" }).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL("/tasks-and-workflows/#remove-worktree");
  await expect(header).toHaveAttribute("data-state", "open");
  await expect(header).toBeFocused();
  await expect(header).toBeInViewport();
});

test("a search tap before the page hydrates opens search when it hydrates", async ({ page }) => {
  let release = () => {};
  const scripts = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/_next/static/chunks/*.js", async (route) => {
    await scripts;
    await route.continue();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("[data-search], [data-search-full]").filter({ visible: true }).first().click();
  await expect(page.locator("html")).not.toHaveAttribute("data-hydrated");
  release();
  await expect(page.getByRole("combobox", { name: "Search" })).toBeVisible();
});
