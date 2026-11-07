import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

// The sidebar of a replica shows the mark of the app, so the package keeps a copy of its file.
test("the sidebar mark is the mark of the app", async () => {
  const [copy, app] = await Promise.all([
    readFile(new URL("./replicas/shell/openducktor-mark.svg", import.meta.url)),
    readFile(new URL("../../frontend/src/assets/openducktor-mark.svg", import.meta.url)),
  ]);
  expect(copy.equals(app)).toBe(true);
});
