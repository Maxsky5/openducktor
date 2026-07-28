import { describe, expect, test } from "bun:test";
import { ELECTRON_WINDOW_TITLE_BAR_HEIGHT } from "../shared/electron-bridge-contract";
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
        height: ELECTRON_WINDOW_TITLE_BAR_HEIGHT,
      },
    });
  });
});
