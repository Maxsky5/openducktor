import { test as base, expect, type Page } from "@playwright/test";
import { publishedPages } from "../lib/pages";

export { expect };

export const test = base.extend<{ securityPolicy: void }>({
  /** Fails each test in which a page breaks a rule of the Content-Security-Policy of `_headers`. */
  securityPolicy: [
    async ({ context }, use) => {
      const violations: string[] = [];
      context.on("console", (message) => {
        if (message.type() === "error" && message.text().includes("Content Security Policy")) {
          violations.push(message.text());
        }
      });
      await use();
      expect(violations).toEqual([]);
    },
    { auto: true },
  ],
});

/** The published pages in navigation order, each with its URL and its MDX file. */
export const PUBLISHED_PAGES = publishedPages();

/** The URL of each published page, such as `/mobile/`. */
export const PAGES = PUBLISHED_PAGES.map((page) => page.url);

export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) < 768;
}

/**
 * Marks the current document. A full page load removes the mark, a client navigation keeps it. A
 * client navigation needs the router, so the mark waits until the page hydrates: a link that the
 * reader selects before that loads its page in full.
 */
export async function markDocument(page: Page): Promise<void> {
  await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
  await page.evaluate(() => {
    document.documentElement.dataset.testDocument = "kept";
  });
}

export async function documentKept(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.dataset.testDocument === "kept");
}

/** Opens the navigation: the sidebar on wide screens, the menu on narrow screens. */
export async function openNavigation(page: Page): Promise<void> {
  if (!isPhone(page)) return;
  const open = page.getByRole("button", { name: "Close Sidebar" }).filter({ visible: true });
  if ((await open.count()) > 0) return;
  // A locator click can scroll the page to the button first, which changes the reading position
  // that the history tests check. A reader taps the sticky button where it is.
  const box = await page
    .locator("#nd-subnav")
    .getByRole("button", { name: "Open Sidebar" })
    .boundingBox();
  if (!box) throw new Error("The menu button of the narrow header is not visible.");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Opens a page from the navigation, as a reader does. */
export async function selectPage(page: Page, name: string): Promise<void> {
  await openNavigation(page);
  await page
    .locator("#nd-sidebar, [data-sidebar-drawer], aside")
    .getByRole("link", { name, exact: true })
    .filter({ visible: true })
    .first()
    .click();
}
