import { expect, test } from "bun:test";
import { readProduct } from "./test-support/product-source";

// The sidebar of a replica shows the mark of the app, so the package keeps a copy of its file.
test("the sidebar mark is the mark of the app", async () => {
  const [copy, app] = await Promise.all([
    Bun.file(new URL("./replicas/shell/openducktor-mark.svg", import.meta.url)).text(),
    readProduct("packages/frontend/src/assets/openducktor-mark.svg"),
  ]);
  expect(copy).toBe(app);
});
