import { readFileSync } from "node:fs";
import { MOTION_STATE, PLAYER_ROOT } from "@openducktor/product-scenes/motion/state";
import type { Locator, Page } from "@playwright/test";
import { expect, openNavigation, PUBLISHED_PAGES, test } from "./fixtures";

// The tests of `@openducktor/product-scenes` check the players and the views. These tests check
// what the docs add: the still frames of the export, the header pause control, and pages that play
// their demonstrations without errors.

/** The published pages that place a demonstration. */
const DEMO_PAGES = PUBLISHED_PAGES.filter(({ file }) =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8").includes("<ProductDemo"),
).map(({ url }) => url);

/** The running web animations of a figure, such as CSS animations on pseudo-elements. */
function runningAnimations(demo: Locator): Promise<number> {
  return demo.evaluate(
    (figure) =>
      document.getAnimations().filter((animation) => {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        return target !== null && figure.contains(target) && animation.playState === "running";
      }).length,
  );
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${message.text()} ${message.location().url}`);
  });
  return errors;
}

/**
 * Scrolls a demonstration into the screen and waits until its player plays it. The player loads
 * when the demonstration comes near the screen. A chapter player then shows one chapter instead of
 * all of them, so the figure gets shorter, and the second scroll brings it back into the screen.
 */
async function showPlaying(demo: Locator): Promise<Locator> {
  const player = demo.locator(PLAYER_ROOT).first();
  await demo.scrollIntoViewIfNeeded();
  await expect(player).toHaveAttribute("data-motion");
  await demo.scrollIntoViewIfNeeded();
  await expect(player).toHaveAttribute("data-motion", MOTION_STATE.running);
  return player;
}

/**
 * Moves the fake clock in short steps. Each step is one animation frame of the scenes, and a tween
 * that a scene adds after a layout change starts close to the change, as in real time.
 */
async function runScenes(page: Page, milliseconds: number): Promise<void> {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
    await page.clock.fastForward(100);
  }
}

test("with reduced motion, every demonstration shows a still frame", async ({ page }) => {
  const errors = collectErrors(page);
  let total = 0;
  for (const path of DEMO_PAGES) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Pause animations" })).toBeHidden();
    for (const demo of await page.locator("figure.docs-demo").all()) {
      total += 1;
      await demo.scrollIntoViewIfNeeded();
      const box = await demo.getByRole("img").first().boundingBox();
      expect(box?.height ?? 0, `${path} shows no still frame`).toBeGreaterThan(80);
      expect(await runningAnimations(demo), `${path} moves`).toBe(0);
    }
  }
  expect(total).toBeGreaterThanOrEqual(DEMO_PAGES.length);
  expect(errors).toEqual([]);
});

for (const path of DEMO_PAGES) {
  test(`the demonstrations of ${path} play without errors`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(path);
    for (const demo of await page.locator("figure.docs-demo").all()) {
      const player = await showPlaying(demo);
      // Each loop is shorter than this time, so the scene starts again and keeps playing.
      await runScenes(page, 40_000);
      await expect(player).toHaveAttribute("data-motion", MOTION_STATE.running);
    }
    expect(errors).toEqual([]);
  });
}

test("the header button pauses and plays every demonstration", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/customize-openducktor/");
  const player = await showPlaying(page.locator("figure.docs-demo").first());
  // A narrow header keeps its buttons in the menu.
  await openNavigation(page);
  await page.getByRole("button", { name: "Pause animations" }).filter({ visible: true }).click();
  await expect(player).toHaveAttribute("data-motion", MOTION_STATE.paused);
  const play = page.getByRole("button", { name: "Play animations" }).filter({ visible: true });
  await expect(play).toHaveAttribute("aria-pressed", "true");
  // The header and the menu each have a button, and both show the state.
  for (const button of await page.locator(".docs-motion-control").all()) {
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  await play.click();
  await expect(player).toHaveAttribute("data-motion", MOTION_STATE.running);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("pages keep their text, still frames, and links, without dead controls", async ({
    page,
  }) => {
    await page.goto("/tasks-and-workflows/spec-plan-build/");
    await expect(page.locator("#docs-title")).toBeVisible();
    await expect(page.locator("figure.docs-demo").first().getByRole("img").first()).toBeVisible();
    await expect(
      page.locator("[data-search], [data-search-full]").filter({ visible: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pause animations" })).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Dark appearance" }).filter({ visible: true }),
    ).toHaveCount(0);
    await expect(page.locator("#nd-page a[href^='/']").first()).toBeVisible();
  });
});
