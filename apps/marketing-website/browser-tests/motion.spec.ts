import { expect, pauseClock, playOnFakeClock, reload, runUntil, shownText, test } from "./fixtures";

test("with motion allowed, the opening view is flat on first paint and after a scroll", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await reload(page);
  const stage = page.locator('[data-scene="hero"] [data-stage]');
  await expect(stage).toHaveCSS("transform", "none");
  await page.mouse.wheel(0, 400);
  await expect(stage).toHaveCSS("transform", "none");
});

test("with reduced motion, the product views show their final state and nothing moves", async ({
  page,
}) => {
  await expect(page.locator("[data-motion-toggle]")).toBeHidden();
  await expect(page.locator("html")).not.toHaveAttribute("data-motion");
  await expect(page.locator("[data-motion]")).toHaveCount(0);
  await expect(page.locator('[data-scene="local"] [data-diag-label]')).toHaveText([
    "Ready",
    "Ready",
    "Ready",
    "Available",
    "Available",
    "Ready",
    "Configured",
    "Ready",
  ]);
  const animated = await page.evaluate(
    () =>
      [...document.querySelectorAll(".replica *, .duck-mark *, .duck-parade *")].filter(
        (element) => getComputedStyle(element).animationName !== "none",
      ).length,
  );
  expect(animated).toBe(0);
  // The duck mark and the duck parade show their last frame, with no transform from GSAP.
  await page.locator("[data-parade]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-parade]")).not.toHaveAttribute("data-motion");
  for (const selector of [".duck-bob", ".parade-train", ".parade-duck"]) {
    for (const element of await page.locator(selector).all()) {
      await expect(element).not.toHaveAttribute("style");
    }
  }
});

test("when motion is allowed, one control pauses and resumes every product view", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await reload(page);
  const hero = page.locator('[data-scene="hero"]');
  // On a phone, the opening view starts below the line where a view starts to move.
  await hero.scrollIntoViewIfNeeded();
  await expect(hero).toHaveAttribute("data-motion", "running");
  await page.getByRole("button", { name: "Pause animations" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "paused");
  await expect(hero).toHaveAttribute("data-motion", "paused");
  const play = page.getByRole("button", { name: "Play animations" });
  await expect(play).toHaveAttribute("aria-pressed", "true");
  // On a phone, the local section is taller than the screen, so the test scrolls to the view.
  const local = page.locator('[data-scene="local"]');
  await local.scrollIntoViewIfNeeded();
  await expect(local).toHaveAttribute("data-motion", "paused");
  await play.click();
  await expect(local).toHaveAttribute("data-motion", "running");
  await expect(hero).toHaveAttribute("data-motion", "paused");
  // The duck parade of the closing section follows the same control.
  const parade = page.locator("[data-parade]");
  await parade.scrollIntoViewIfNeeded();
  await expect(parade).toHaveAttribute("data-motion", "running");
  await page.getByRole("button", { name: "Pause animations" }).click();
  await expect(parade).toHaveAttribute("data-motion", "paused");
});

const scenes = [
  "hero",
  "palette",
  "runtimes",
  "autopilot",
  "chat",
  "mcp",
  "prompts",
  "actions",
  "local",
];
/**
 * The markup of a view holds the frame that visitors without motion see, most often the last
 * frame of the loop. The opening view holds its first frame, so the page does not change under
 * the first paint. The prompt editor holds the placeholder error from the middle of its loop,
 * because that frame shows the check. The command palette holds its search results from the
 * middle of its loop, because the loop ends with the palette closed. The runtime defaults hold
 * the last frame with the model picker still open, so they show a model list.
 */
const stillFrames = new Map([
  ["hero", "first"],
  ["palette", "middle"],
  ["prompts", "middle"],
]);
const stillOnly = new Map([["runtimes", "[data-picker]"]]);

test("each product view plays one loop, ends on its static frame, and cross fades into the next loop", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-light", "One project plays the long scenes.");
  // The fake clock plays one loop of each view, one step at a time.
  test.setTimeout(300_000);
  // With reduced motion, the markup shows the static frame of each view.
  const still = new Map<string, string>();
  for (const id of scenes) {
    still.set(id, await shownText(page, `[data-scene="${id}"] [data-stage]`, stillOnly.get(id)));
  }
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await playOnFakeClock(page);
  for (const id of scenes) {
    const scene = page.locator(`[data-scene="${id}"]`);
    const stage = scene.locator("[data-stage]");
    const cover = scene.locator("[data-stage-cover]");
    await scene.scrollIntoViewIfNeeded();
    await runUntil(page, async () => (await cover.count()) > 0, 60);
    // The cover holds the last frame of the loop. The stage holds the first frame of the next loop.
    await expect(cover, id).toHaveAttribute("aria-hidden", "true");
    const kind = stillFrames.get(id) ?? "last";
    if (kind !== "middle") {
      const frame = kind === "first" ? "[data-stage]" : "[data-stage-cover]";
      expect(await shownText(page, `[data-scene="${id}"] ${frame}`), id).toBe(still.get(id));
    }
    expect(await stage.evaluate((element) => getComputedStyle(element).opacity), id).toBe("1");
    if (id === "local") {
      // The panel scrolled to its end. The cover keeps that scroll, so the frame does not jump.
      const scroll = await cover.locator("[data-diag-scroll]").evaluate((panel) => panel.scrollTop);
      expect(scroll).toBeGreaterThan(0);
    }
    await runUntil(page, async () => (await cover.count()) === 0, 2);
    await expect(cover, id).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("on a phone, each product view plays one loop without a page error", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone-light", "One phone project plays the long scenes.");
  // A narrow stage hides parts of the windows, and a scene must not point at a hidden part.
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await playOnFakeClock(page);
  for (const id of scenes) {
    const scene = page.locator(`[data-scene="${id}"]`);
    await scene.scrollIntoViewIfNeeded();
    await runUntil(page, async () => (await scene.locator("[data-stage-cover]").count()) > 0, 60);
    await expect(scene.locator("[data-stage-cover]"), id).toHaveCount(1);
  }
  expect(errors).toEqual([]);
});

test("a switch to reduced motion while the views play puts back their static frames", async ({
  page,
}) => {
  const hero = '[data-scene="hero"] [data-stage]';
  const still = await shownText(page, hero);
  await playOnFakeClock(page);
  await page.locator('[data-scene="hero"]').scrollIntoViewIfNeeded();
  await page.clock.runFor(3000);
  expect(await shownText(page, hero)).not.toBe(still);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-motion]")).toHaveCount(0);
  await expect(page.locator("[data-motion-toggle]")).toBeHidden();
  await expect(page.locator("[data-stage-cover]")).toHaveCount(0);
  expect(await shownText(page, hero)).toBe(still);
});

test("the pause control freezes the views", async ({ page }) => {
  await playOnFakeClock(page);
  const scene = page.locator('[data-scene="hero"]');
  const stage = scene.locator("[data-stage]");
  await scene.scrollIntoViewIfNeeded();
  await page.clock.runFor(2000);
  // Before a click, Playwright scrolls the sticky header button to its place at the top of the
  // page, so the test shows the view again after each click.
  const show = async (motion: string): Promise<void> => {
    await scene.scrollIntoViewIfNeeded();
    await page.clock.runFor(100);
    await expect(scene).toHaveAttribute("data-motion", motion);
  };
  await page.getByRole("button", { name: "Pause animations" }).click();
  await show("paused");
  const frame = await stage.innerHTML();
  await page.clock.runFor(3000);
  expect(await stage.innerHTML()).toBe(frame);
  // CSS pulses the glow and the ring of a running dot. The control pauses them too.
  const pulses = await stage
    .locator('[data-dot="running"]')
    .first()
    .evaluate((dot) =>
      ["::before", "::after"].map((part) => getComputedStyle(dot, part).animationPlayState),
    );
  expect(pulses).toEqual(["paused", "paused"]);
  await page.getByRole("button", { name: "Play animations" }).click();
  await show("running");
  await page.clock.runFor(1000);
  expect(await stage.innerHTML()).not.toBe(frame);
});

// The lanes fit at the desktop size. At tablet and phone sizes, the board scrolls with the task.

for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 800 },
  { width: 768, height: 1000 },
  { width: 320, height: 740 },
]) {
  test(`at ${size.width} px, the Autopilot task stays on the board and no notification covers a card`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-light", "The test sets its own viewport size.");
    // The test plays a whole loop in 290 steps of the fake clock.
    test.setTimeout(240_000);
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize(size);
    await reload(page);
    const scene = page.locator('[data-scene="autopilot"]');
    await scene.scrollIntoViewIfNeeded();
    await expect(scene).toHaveAttribute("data-motion", "running");
    await pauseClock(page);
    const lanes = new Set<string>();
    let notifications = 0;
    // One loop of the scene is shorter than 29 seconds.
    for (let step = 0; step < 290; step++) {
      await page.clock.runFor(100);
      // The live stage only: a loop ends with a fading copy of its last frame over the stage.
      const frame = await scene.locator("[data-stage]").evaluate((root) => {
        const area = (a: DOMRect, b: DOMRect) =>
          Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
          Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const board = root.querySelector(".board-viewport")!.getBoundingClientRect();
        const toasts = [...root.querySelectorAll<HTMLElement>(".toast-stack > .toast")]
          .filter((toast) => Number(getComputedStyle(toast).opacity) > 0.3)
          .map((toast) => toast.getBoundingClientRect());
        // A moving card hides in its lane while a copy flies.
        const cards = [...root.querySelectorAll<HTMLElement>(".board-track .card")].filter(
          (card) => card.style.visibility !== "hidden" && card.offsetHeight > 20,
        );
        const task = cards.find((card) => card.dataset.card === "import")!;
        const box = task.getBoundingClientRect();
        return {
          lane: task.closest<HTMLElement>(".lane")?.dataset.lane ?? "flying",
          onBoard: area(box, board) / (box.width * box.height),
          // A flying card can pass under a notification, as it does in the app.
          covered: cards
            .filter((card) => !card.hasAttribute("data-flying"))
            .some((card) => toasts.some((toast) => area(card.getBoundingClientRect(), toast) > 1)),
          toasts: toasts.length,
        };
      });
      expect(frame.onBoard, `at ${step * 100} ms`).toBeGreaterThan(0.99);
      expect(frame.covered, `at ${step * 100} ms`).toBe(false);
      lanes.add(frame.lane);
      notifications += frame.toasts;
    }
    expect([...lanes]).toEqual(
      expect.arrayContaining([
        "spec_ready",
        "ready_for_dev",
        "in_progress",
        "ai_review",
        "human_review",
      ]),
    );
    expect(notifications).toBeGreaterThan(0);
  });
}

test("the chat opens a new task and starts its Builder in the background", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-light", "One project plays the long scenes.");
  test.setTimeout(120_000);
  await playOnFakeClock(page);
  const scene = page.locator('[data-scene="chat"]');
  await scene.scrollIntoViewIfNeeded();
  const stage = scene.locator("[data-stage]");
  // The task details of the new task slide in over the chat.
  await runUntil(page, async () => (await stage.locator("[data-sheet]").count()) > 0, 40);
  await expect(stage.locator("[data-sheet-start]")).toHaveText("Start Builder");
  // The start dialog offers to run the Builder in the background.
  const background = stage.locator("[data-background]");
  await runUntil(page, async () => (await background.count()) > 0, 10);
  await expect(background).toHaveText("Run in background");
  // The Builder joins Running, and the chat stays on screen and selected.
  const builder = stage.locator('[data-nav-list="running"] [data-nav-entry="menu-build"]');
  await runUntil(page, () => builder.isVisible(), 10);
  await expect(builder).toBeVisible();
  await expect(stage.locator('[data-nav-entry="plan-chat"] [data-nav-row]')).toHaveAttribute(
    "data-selected",
  );
});

test("the opening view answers a question in the session preview of the sidebar", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-light", "One project plays the long scenes.");
  test.setTimeout(180_000);
  await playOnFakeClock(page);
  const scene = page.locator('[data-scene="hero"]');
  await scene.scrollIntoViewIfNeeded();
  const stage = scene.locator("[data-stage]");
  const waiting = stage.locator('[data-nav-list="needs_you"] [data-nav-entry="empty-build"]');
  // The Builder asks its question, and the preview of its session opens with it.
  const preview = stage.locator("[data-preview]");
  await runUntil(page, async () => (await preview.count()) > 0, 60);
  await expect(waiting).toBeVisible();
  await expect(preview.locator("[data-reply]")).toContainText("Reply here");
  // The answer is sent from the preview, and the session goes back to Running.
  await runUntil(page, () => preview.locator("[data-reply-sent]").isVisible(), 10);
  await expect(preview.locator("[data-reply-sent]")).toHaveText("Answer sent.");
  const running = stage.locator('[data-nav-list="running"] [data-nav-entry="empty-build"]');
  await runUntil(page, () => running.isVisible(), 5);
  await expect(running).toBeVisible();
});
