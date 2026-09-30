import { expect, playOnFakeClock, reload, runUntil, shownText, steps, test } from "./fixtures";

test("the workflow steps are tabs with arrows, Home, End, and one tab stop", async ({ page }) => {
  const tablist = page.getByRole("tablist", { name: "Workflow steps" });
  const tabs = tablist.getByRole("tab");
  await expect(tabs).toHaveCount(steps.length);
  // A tab has a short name. Its text goes to the description.
  await expect(tabs.first()).toHaveAccessibleName("01 Spec");
  await expect(tabs.first()).toHaveAccessibleDescription(/^The Spec agent reads the task/);
  const panels = page.locator('#workflow [role="tabpanel"]');
  await tabs.first().focus();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.last()).toBeFocused();
  await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#workflow-panel-review")).toBeVisible();
  await expect(panels.filter({ visible: true })).toHaveCount(1);
  await page.keyboard.press("ArrowRight");
  await expect(tabs.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(tabs.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.first()).toBeFocused();
  await expect(tablist.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  for (const [index, id] of steps.entries()) {
    await tabs.nth(index).click();
    await expect(page.locator(`#workflow-panel-${id}`)).toBeVisible();
    await expect(page.locator(`#workflow-panel-${id} [data-stage]`)).toHaveAttribute(
      "aria-label",
      /^Agent Studio\./,
    );
    await expect(panels.filter({ visible: true })).toHaveCount(1);
  }
});

test("on a phone, a longer workflow text moves the start line of the view below", async ({
  page,
}, testInfo) => {
  // A viewport change refreshes the triggers, so the test uses the phone size from the start.
  test.skip(testInfo.project.name !== "phone-light", "The test needs the phone width.");
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The phone project needs a viewport size.");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await reload(page);
  const chapters = page.locator(".chapters");
  const before = await chapters.evaluate((element) => element.getBoundingClientRect().height);
  await page.getByRole("tab", { name: "03 Build" }).click();
  // At this width, the Build text takes one more line than the Spec text.
  await expect
    .poll(() => chapters.evaluate((element) => element.getBoundingClientRect().height))
    .toBeGreaterThan(before + 10);
  // The Runtimes view moves only while its top is above 88% of the screen.
  const runtimes = page.locator('[data-scene="runtimes"]');
  const line = viewport.height * 0.88;
  const placeTop = (top: number) =>
    runtimes.evaluate((element, y) => {
      window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - y);
    }, top);
  await placeTop(line - 10);
  await expect(runtimes).toHaveAttribute("data-motion", "running");
  await placeTop(line + 10);
  await expect(runtimes).toHaveAttribute("data-motion", "paused");
});

test("each workflow step ends on its static frame, and the next step starts there", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-light", "One project plays the long scenes.");
  // The fake clock plays the five steps and the return to the first step.
  test.setTimeout(420_000);
  // With reduced motion, a tab shows the static frame of its step.
  const still = new Map<string, string>();
  for (const [index, id] of steps.entries()) {
    await page.getByRole("tab").nth(index).click();
    still.set(id, await shownText(page, `#workflow-panel-${id} [data-stage]`));
  }
  await playOnFakeClock(page);
  const chapters = page.locator(".chapters");
  const cover = chapters.locator("[data-stage-cover]");
  const stage = chapters.locator("[data-chapter-panel]:not([hidden]) [data-stage]");
  await chapters.scrollIntoViewIfNeeded();
  for (const [index, id] of steps.entries()) {
    const next = steps[(index + 1) % steps.length];
    await runUntil(page, async () => (await cover.count()) > 0, 90);
    await expect(page.getByRole("tab", { selected: true })).toHaveAttribute(
      "data-chapter",
      next ?? "",
    );
    // The cover holds the last frame of the step before. The stage holds the first frame.
    expect(await shownText(page, ".chapters [data-stage-cover]"), `the last frame of ${id}`).toBe(
      still.get(id),
    );
    const [last, first] = await chapters.evaluate((root) =>
      ["[data-stage-cover]", "[data-chapter-panel]:not([hidden]) [data-stage]"].map((selector) => {
        const frame = root.querySelector(selector);
        if (!frame) throw new Error(`The chapter player has no ${selector}.`);
        const rail = [...frame.querySelectorAll(".st-step[data-step]")];
        return {
          action: frame.querySelector("[data-action]")?.textContent,
          model: frame.querySelector("[data-model]")?.textContent,
          tones: rail.map((step) => step.getAttribute("data-tone")),
          selected: rail.findIndex((step) => step.getAttribute("aria-pressed") === "true"),
        };
      }),
    );
    // The last step ends the story, and the first step starts a new task. The Review step opens
    // after QA approves the fix.
    if (next !== "spec" && next !== "review") {
      expect(first, `the first frame of ${next}`).toEqual(last);
    }
    await runUntil(page, async () => (await cover.count()) === 0, 2);
    await expect(cover).toHaveCount(0);
    if (next === "qa") {
      // You start the QA review. No QA session exists yet, so only a fresh start is possible.
      const dialog = stage.locator(".st-dialog");
      await runUntil(page, async () => (await dialog.count()) > 0, 5);
      await expect(dialog).toContainText("Start QA Session");
      await expect(stage.locator('[data-mode="reuse"]')).toHaveAttribute("data-disabled");
    }
  }
});
