import { expect, test } from "./fixtures";

// `tests/diagrams.test.ts` checks the specs of every diagram. This check covers what only a
// browser shows: React Flow draws the lines and the labels after hydration.
test("a page draws the lines and the labels of its diagrams", async ({ page }) => {
  await page.goto("/tasks-and-workflows/spec-plan-build/");
  const diagram = page.locator(".docs-flow-canvas").filter({ visible: true }).first();
  await diagram.scrollIntoViewIfNeeded();
  // A straight vertical line has no width, so the check counts the lines that a reader can see.
  await expect(diagram.locator(".react-flow__edge-path").filter({ visible: true })).not.toHaveCount(
    0,
  );
  await expect(diagram.locator(".docs-flow-label").first()).toBeVisible();
});
