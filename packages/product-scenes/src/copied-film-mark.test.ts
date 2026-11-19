import { expect, test } from "bun:test";
import { DUCK } from "./films/frame/Mark";

// The titles of a film draw the mark of the app in parts, so each part can move. The parts must
// stay the paths of the mark that the sidebar copies from the app.
test("the film mark draws the paths of the app mark", async () => {
  const mark = await Bun.file(
    new URL("./replicas/shell/openducktor-mark.svg", import.meta.url),
  ).text();
  for (const path of [DUCK.body, DUCK.bill, DUCK.visor, DUCK.light]) {
    expect(mark).toContain(`d="${path}"`);
  }
  const { cx, cy, r } = DUCK.head;
  expect(mark).toContain(`<circle cx="${cx}" cy="${cy}" r="${r}"/>`);
});
