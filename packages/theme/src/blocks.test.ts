import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { readThemeBlocks, TOKENS_FILE } from "./blocks";

describe("readThemeBlocks", () => {
  test("reads the light and the dark declarations of tokens.css without their selectors", async () => {
    const { light, dark } = readThemeBlocks(await readFile(TOKENS_FILE, "utf8"));
    for (const block of [light, dark]) {
      expect(block).toContain("--primary:");
      expect(block).toContain("--sidebar-foreground:");
      expect(block).not.toContain("{");
    }
    expect(light).toContain("color-scheme: light");
    expect(dark).toContain("color-scheme: dark");
  });

  test("fails with an actionable error when a theme block moves", () => {
    for (const source of ["", ":root, .light { --primary: red; }", ".dark { --primary: red; }"]) {
      expect(() => readThemeBlocks(source)).toThrow("Update readThemeBlocks");
    }
  });
});
