import {
  documentKept,
  expect,
  horizontalOverflow,
  isPhone,
  markDocument,
  PAGES,
  selectPage,
  test,
} from "./fixtures";

test("every published page loads directly with its full content", async ({ page }) => {
  for (const path of PAGES) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator("#docs-title"), path).toBeVisible();
    expect(await horizontalOverflow(page), `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});

test("an unknown path answers 404 with links back to the documentation", async ({ page }) => {
  const response = await page.goto("/no-such-page/");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: "Read the overview" }).click();
  await expect(page).toHaveURL("/");
});

test("navigation changes pages in the same document and keeps history", async ({ page }) => {
  await page.goto("/");
  await markDocument(page);
  await selectPage(page, "Coding sessions");
  await expect(page).toHaveURL("/coding-sessions/");
  await expect(page.locator("#docs-title")).toHaveText("Coding sessions");
  await expect(page.locator("#docs-title")).toBeFocused();
  expect(await documentKept(page)).toBe(true);
  if (isPhone(page)) {
    // The menu closes after the selection, and focus is on the title, not in the hidden menu.
    await expect(page.locator("#nd-sidebar-mobile")).toBeHidden();
  }

  await page.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  const position = await page.evaluate(() => window.scrollY);
  await selectPage(page, "Autopilot");
  await expect(page).toHaveURL("/autopilot/");

  await page.goBack();
  await expect(page).toHaveURL("/coding-sessions/");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(position - 50);
  await page.goForward();
  await expect(page).toHaveURL("/autopilot/");
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL("/");
  expect(await documentKept(page)).toBe(true);
});

test("a section link opens its heading below the sticky bars", async ({ page }) => {
  for (const path of ["/troubleshooting/#diagnostics", "/settings-reference/#notifications"]) {
    await page.goto(path);
    const heading = page.locator(`[id="${path.split("#")[1]}"]`);
    await expect(heading).toBeInViewport();
    // The element at the top of the heading is the heading, not a sticky bar over it.
    const visible = await heading.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + 8, box.top + 4);
      return top !== null && element.contains(top);
    });
    expect(visible, path).toBe(true);
  }
});

test("a malformed section address still shows the page", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  // The troubleshooting page has accordions, which read the hash when they mount.
  await page.goto("/troubleshooting/#%");
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await expect(page.locator("#docs-title")).toHaveText("Troubleshooting");
  expect(errors).toEqual([]);
});

test("the skip link moves focus to the page title", async ({ page }) => {
  await page.goto("/install-and-update/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#docs-title")).toBeFocused();
});

test("after Back between sections of a page, the next page still gets focus", async ({ page }) => {
  await page.goto("/install-and-update/");
  const section = await page.locator("#nd-page h2[id]").first().getAttribute("id");
  await page.evaluate((id) => {
    const link = document.createElement("a");
    link.href = `#${id}`;
    document.body.append(link);
    link.click();
    link.remove();
  }, section);
  await expect(page).toHaveURL(`/install-and-update/#${section}`);
  await page.goBack();
  await expect(page).toHaveURL("/install-and-update/");
  await selectPage(page, "Coding sessions");
  await expect(page.locator("#docs-title")).toHaveText("Coding sessions");
  await expect(page.locator("#docs-title")).toBeFocused();
});

test("a link to a closed accordion on the same page opens it", async ({ page }) => {
  await page.goto("/troubleshooting/");
  const header = page.locator("#git-issue");
  await expect(header).toHaveAttribute("data-state", "closed");
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "#git-issue";
    document.body.append(link);
    link.click();
    link.remove();
  });
  await expect(page).toHaveURL("/troubleshooting/#git-issue");
  await expect(header).toHaveAttribute("data-state", "open");
  await expect(header).toBeFocused();
  await expect(header).toBeInViewport();
});

test("a wide table scrolls with the keyboard inside its own box", async ({ page }) => {
  test.skip(!isPhone(page), "Tables fit the article on wide screens.");
  // The feature table of the harnesses, with a column for each harness, is wider than a phone.
  await page.goto("/harnesses/");
  const box = page.locator("#nd-page div[tabindex='0']:has(> table)");
  const wide = await box.evaluateAll((elements) =>
    elements.findIndex((element) => element.scrollWidth > element.clientWidth),
  );
  expect(wide).toBeGreaterThanOrEqual(0);
  const target = box.nth(wide);
  await target.scrollIntoViewIfNeeded();
  await target.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => target.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("a tab shows its focus ring after keyboard use only", async ({ page }) => {
  await page.goto("/install-and-update/");
  const windows = page.getByRole("tab", { name: "Windows" });
  await windows.click();
  await expect(windows).toHaveAttribute("aria-selected", "true");
  expect(await windows.evaluate((tab) => getComputedStyle(tab).outlineStyle)).toBe("none");
  await page.keyboard.press("ArrowRight");
  const linux = page.getByRole("tab", { name: "Linux" });
  await expect(linux).toBeFocused();
  expect(await linux.evaluate((tab) => getComputedStyle(tab).outlineStyle)).toBe("solid");
});
