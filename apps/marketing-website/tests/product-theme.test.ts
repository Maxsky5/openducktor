import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { productTheme } from "../scripts/product-theme";

test("scopes both desktop themes to the replicas, without desktop selectors or Tailwind directives", async () => {
  const source = await readFile(
    new URL("../../../packages/frontend/src/styles.css", import.meta.url),
    "utf8",
  );
  const result = productTheme(source);
  expect(result).toContain("@layer product {\n.replica {");
  expect(result).toContain(':root[data-theme="dark"] .replica {');
  expect(result).not.toMatch(/^:root \{/m);
  expect(result).toContain("--sidebar-foreground:");
  expect(result).toContain("--success-surface:");
  expect(result).not.toContain("@import");
  expect(result).not.toContain("@plugin");
  expect(result).not.toContain(".dark");
});

test("fails with an actionable error when either desktop theme block moves", () => {
  for (const source of ["", ":root, .light { --primary: red; }", ".dark { --primary: red; }"]) {
    expect(() => productTheme(source)).toThrow("Update the marketing theme extraction");
  }
});
