import { describe, expect, test } from "bun:test";
import { resolveElectronWindowChromeOptions } from "./electron-window-chrome";

describe("resolveElectronWindowChromeOptions", () => {
  test("keeps inset native traffic lights on macOS", () => {
    expect(resolveElectronWindowChromeOptions("darwin")).toEqual({
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 13 },
    });
  });

  test.each(["win32", "linux"] as const)("uses native overlay controls on %s", (platform) => {
    expect(resolveElectronWindowChromeOptions(platform)).toEqual({
      titleBarStyle: "hidden",
      titleBarOverlay: {
        height: 40,
      },
    });
  });
});
