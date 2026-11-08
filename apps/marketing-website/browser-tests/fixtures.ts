import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { commands } from "../src/content/site";

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
  /** Each test starts on the home page, in the theme of its project. */
  page: async ({ page, javaScriptEnabled }, use, testInfo) => {
    await page.goto("/");
    if (javaScriptEnabled && testInfo.project.name.endsWith("dark")) {
      await page.getByRole("button", { name: "Use dark theme" }).click();
    }
    await use(page);
  },
});

export const steps = ["spec", "plan", "build", "qa", "review"];

/** The id, the terminal title, the command name in the copy button, and the command. */
export const desktopInstalls = [
  ["unix", "macOS and Linux", "macOS and Linux", commands.unix],
  ["windows", "Windows", "Windows", commands.windows],
  ["brew", "Homebrew", "Homebrew", commands.brew],
] as const;
export const installs = [
  ...desktopInstalls,
  ["browser", "macOS, Windows, and Linux", "Browser version", commands.browser],
] as const;

export function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

export function clipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Reloads the page and keeps the theme that the test chose. */
export async function reload(page: Page): Promise<void> {
  const dark = await page.evaluate(() => document.documentElement.dataset.theme === "dark");
  await page.reload();
  if (dark) await page.getByRole("button", { name: "Use dark theme" }).click();
}

/** Stops a fake clock half a second after the current time, with margin for a slow page. */
export async function pauseClock(page: Page): Promise<void> {
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500);
}

/**
 * Reloads the page with motion allowed, on a fake clock that stops at once. The scenes move only
 * when the test runs the clock, so every run sees the same frames.
 */
export async function playOnFakeClock(page: Page): Promise<void> {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await reload(page);
  await pauseClock(page);
}

/** GSAP sets each frame from the clock time, and it treats a gap above 500 ms as lag. */
const clockStepMs = 250;

/** Moves the fake clock forward by `ms`, with one animation frame per step of `clockStepMs`. */
export async function advance(page: Page, ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= clockStepMs) {
    await page.clock.fastForward(Math.min(left, clockStepMs));
  }
}

/**
 * Scrolls a view into its play zone and waits for its motion state. The page scrolls smoothly in
 * real time, but `advance` moves the fake clock at once, so a test waits for the scroll first.
 */
export async function scrollIntoPlayZone(
  view: Locator,
  motion: "running" | "paused" = "running",
): Promise<void> {
  await view.scrollIntoViewIfNeeded();
  await expect(view).toHaveAttribute("data-motion", motion);
}

/** Runs the fake clock in steps until `done` is true. `limit` is in seconds of scene time. */
export async function runUntil(
  page: Page,
  done: () => Promise<boolean>,
  limit: number,
): Promise<void> {
  for (let time = 0; time < limit * 1000 && !(await done()); time += clockStepMs) {
    await advance(page, clockStepMs);
  }
}

/**
 * The text that a visitor reads in an element, with the white space of the layout folded. The
 * parts that match `without` do not count.
 */
export function shownText(page: Page, selector: string, without?: string): Promise<string> {
  return page.locator(selector).evaluate((element, skipped) => {
    if (!(element instanceof HTMLElement)) throw new Error("The text needs an HTML element.");
    const parts = skipped ? [...element.querySelectorAll<HTMLElement>(skipped)] : [];
    const shown = parts.map((part) => part.hidden);
    for (const part of parts) part.hidden = true;
    const text = element.innerText.replace(/\s+/g, " ").trim();
    parts.forEach((part, index) => {
      part.hidden = shown[index] ?? false;
    });
    return text;
  }, without);
}
