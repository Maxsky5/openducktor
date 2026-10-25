import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  GENERATED_TOKENS_PATH,
  readDesktopThemeColors,
  renderDesktopColorsModule,
} from "../../scripts/desktop-theme-tokens";

describe("desktop color tokens", () => {
  test("match the desktop theme", () => {
    expect(readFileSync(GENERATED_TOKENS_PATH, "utf8")).toBe(
      renderDesktopColorsModule(readDesktopThemeColors()),
    );
  });

  test("resolve brand and surface colors to sRGB", () => {
    const colors = readDesktopThemeColors();
    expect(colors.light.primary).toBe("#5100ff");
    expect(colors.light.card).toBe("#ffffff");
    expect(colors.dark.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(colors.light.selectedSurface).toMatch(/^#[0-9a-f]{8}$/);
  });
});
