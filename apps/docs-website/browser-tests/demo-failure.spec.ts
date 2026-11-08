import { MOTION_STATE, PLAYER_ROOT } from "@openducktor/product-scenes/motion/state";
import { expect, selectPage, test } from "./fixtures";

const MESSAGE = "The animation did not load. Reload the page to try again.";

test("a demonstration that does not load keeps its still frame and tells the reader", async ({
  page,
  request,
}) => {
  // The HTML lists the chunks that start the page. A scene loads its timeline in another chunk
  // after the page starts, so the test blocks each chunk that the HTML does not list.
  const html = await (await request.get("/troubleshooting/")).text();
  const pageChunks = new Set(html.match(/\/_next\/static\/chunks\/[^"]+\.js/g));
  await page.route("**/_next/static/chunks/*.js", (route) =>
    pageChunks.has(new URL(route.request().url()).pathname) ? route.continue() : route.abort(),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/troubleshooting/");

  const demo = page.locator("figure.docs-demo").first();
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.getByText(MESSAGE)).toBeVisible();
  await expect(demo.getByRole("img").first()).toBeVisible();
  await expect(demo.locator(PLAYER_ROOT)).not.toHaveAttribute("data-motion");
  await expect(page.locator("#docs-title")).toBeVisible();
  await expect(page.getByText("Application error")).toHaveCount(0);
  // The page reports the cause of the failure.
  expect(errors).not.toEqual([]);

  // A later visit of the page loads the timeline again.
  await page.unrouteAll();
  await selectPage(page, "Mobile");
  await expect(page).toHaveURL("/mobile/");
  await page.goBack();
  await expect(page).toHaveURL("/troubleshooting/");
  await demo.scrollIntoViewIfNeeded();
  await expect(demo.locator(PLAYER_ROOT)).toHaveAttribute("data-motion", MOTION_STATE.running);
  await expect(demo.getByText(MESSAGE)).toHaveCount(0);
});
