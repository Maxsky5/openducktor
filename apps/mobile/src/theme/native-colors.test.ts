import { describe, expect, test } from "bun:test";
import config from "../../app.config";
import { semanticColors } from "./colors";

const pluginEntry = (name: string) =>
  config.plugins?.find((plugin) => Array.isArray(plugin) && plugin[0] === name);

describe("native colors", () => {
  test("match the screen background and tint", () => {
    const { light, dark } = semanticColors;
    expect(pluginEntry("./plugins/with-android-theme-colors.js")).toEqual([
      "./plugins/with-android-theme-colors.js",
      {
        light: { background: light.background, accent: light.tint },
        dark: { background: dark.background, accent: dark.tint },
      },
    ]);
    expect(pluginEntry("expo-splash-screen")).toMatchObject([
      "expo-splash-screen",
      { backgroundColor: light.background, dark: { backgroundColor: dark.background } },
    ]);
    expect(config.backgroundColor).toBe(dark.background);
  });
});
