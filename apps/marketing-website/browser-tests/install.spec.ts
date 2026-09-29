import { commands } from "../src/content/site";
import {
  clipboard,
  desktopInstalls,
  expect,
  installs,
  playOnFakeClock,
  reload,
  test,
} from "./fixtures";

test("each install method has a terminal with its command and a copy button", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const install = page.locator("#install");
  await expect(install.getByRole("heading", { level: 3 })).toHaveText([
    "You need",
    "Desktop app",
    "Browser version",
  ]);
  await expect(install.locator(".install-method")).toHaveCount(installs.length);
  for (const [, title, label, command] of installs) {
    const method = page.getByRole("article", { name: title, exact: true });
    await expect(method.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(method.locator(".t-input code")).toHaveText(command);
    await method.getByRole("button", { name: `Copy command: ${label}` }).click();
    await expect.poll(() => clipboard(page)).toBe(command);
    await expect(method.getByRole("status")).toHaveText("Command copied.");
  }
});

test("the desktop terminals show only their command, and they do not move", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await reload(page);
  await page.locator("[data-install]").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-install]")).toHaveAttribute("data-motion", "running");
  for (const [, title, , command] of desktopInstalls) {
    const screen = page
      .getByRole("article", { name: title, exact: true })
      .locator(".terminal-screen");
    await expect(screen.locator(".t-line")).toHaveCount(1);
    await expect(screen.locator(".t-input code")).toHaveText(command);
    await expect(screen.locator("[data-pending]")).toHaveCount(0);
  }
});

test("a failed copy tells the visitor to select the command", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("The clipboard is blocked.")) },
    });
  });
  await reload(page);
  const method = page.getByRole("article", { name: "Windows", exact: true });
  await method.getByRole("button", { name: "Copy command: Windows" }).click();
  await expect(method.getByRole("status")).toHaveText(
    "Could not copy. Select the command and copy it.",
  );
  await expect(method.getByRole("status")).toBeVisible();
});

test("the browser version terminal types its command, then prints the start log", async ({
  page,
}) => {
  // The clock stops before the scroll, so a slow runner cannot type the command before the checks.
  await playOnFakeClock(page);
  const scene = page.locator("[data-install]");
  const ready = scene.locator(".t-log").filter({ hasText: "OpenDucktor web is ready:" });
  await scene.scrollIntoViewIfNeeded();
  await page.clock.runFor(100);
  await expect(scene).toHaveAttribute("data-motion", "running");
  await expect(ready).toHaveAttribute("data-pending");
  // The part of the command that is not typed yet keeps its place, but it does not show.
  const rest = scene.locator("[data-rest]");
  await expect(rest).not.toBeEmpty();
  await expect(rest).toHaveCSS("visibility", "hidden");
  // The command takes less than a second to type. The host takes longer to get ready.
  await page.clock.runFor(1000);
  await expect(scene.locator("[data-typed]")).toHaveText(commands.browser);
  await expect(rest).toBeEmpty();
  await expect(ready).toHaveAttribute("data-pending");
  await page.clock.runFor(4000);
  await expect(scene.locator("[data-pending]:not(:empty)")).toHaveCount(0);
  await expect(ready).not.toHaveAttribute("data-pending");
  await expect(scene.locator(".t-log").last()).toContainText("Backend: http://127.0.0.1:14327");
});

test("the install terminals keep their size, and the pause control shows the start log at once", async ({
  page,
}) => {
  const terminals = page.locator("#install .terminal");
  const heights = () =>
    terminals.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
  await playOnFakeClock(page);
  const before = await heights();
  // While the browser version terminal types, the text that comes later hides but keeps its place.
  await page.locator("[data-install]").scrollIntoViewIfNeeded();
  await page.clock.runFor(500);
  const hidden = page.locator("[data-install] [data-pending]:not(:empty)");
  await expect(hidden).not.toHaveCount(0);
  expect(await heights()).toEqual(before);
  await page.getByRole("button", { name: "Pause animations" }).click();
  await expect(hidden).toHaveCount(0);
  expect(await heights()).toEqual(before);
});

test("the copy feedback of the opening command does not move the layout", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const command = page.locator(".hero .command");
  const before = await command.boundingBox();
  await command.getByRole("button", { name: "Copy command: browser version" }).click();
  await expect.poll(() => clipboard(page)).toBe(commands.browser);
  await expect(command.getByRole("button")).toHaveAttribute("data-copy-state", "copied");
  await expect(command.locator(".check-icon")).toBeVisible();
  await expect(command.getByRole("status")).toHaveText("Command copied.");
  expect((await command.boundingBox())?.height).toBe(before?.height);
});
