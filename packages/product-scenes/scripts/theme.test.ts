import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { TOKENS_FILE } from "@openducktor/theme/blocks";
import { sceneTheme, THEME_FILE } from "./theme";

test("styles/theme.css matches the desktop theme tokens", async () => {
  const expected = sceneTheme(await readFile(TOKENS_FILE, "utf8"));
  const actual = await readFile(THEME_FILE, "utf8");
  if (actual !== expected) {
    throw new Error(
      "styles/theme.css does not match @openducktor/theme/tokens.css. Run `bun run build:theme` in packages/product-scenes.",
    );
  }
});

test("applies both themes to the replica root only, without desktop selectors", async () => {
  const theme = sceneTheme(await readFile(TOKENS_FILE, "utf8"));
  expect(theme).toContain("@layer product {\n  :where(.stage) .replica {");
  expect(theme).toContain(':is(:root, .scene)[data-theme="dark"] :where(.stage) .replica {');
  expect(theme).toContain("--sidebar-foreground:");
  expect(theme).toContain("--success-surface:");
  expect(theme).not.toMatch(/^:root/m);
  expect(theme).not.toContain(".dark");
  expect(theme).not.toContain("@import");
});

test("gives each theme --brand, the sRGB value of its --primary", async () => {
  const theme = sceneTheme(await readFile(TOKENS_FILE, "utf8"));
  expect(theme.match(/--brand: #5100ff;/g)).toHaveLength(2);
});
