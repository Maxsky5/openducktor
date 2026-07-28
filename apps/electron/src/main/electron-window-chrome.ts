import type { AppPlatform } from "@openducktor/contracts";
import type { BrowserWindowConstructorOptions } from "electron";
import { ELECTRON_WINDOW_TITLE_BAR_HEIGHT } from "../shared/electron-bridge-contract";

type ElectronWindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  "titleBarOverlay" | "titleBarStyle" | "trafficLightPosition"
>;

export const resolveElectronWindowChromeOptions = (
  platform: AppPlatform,
): ElectronWindowChromeOptions => {
  switch (platform) {
    case "darwin":
      return {
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 14, y: 13 },
      };
    case "linux":
    case "win32":
      return {
        titleBarStyle: "hidden",
        titleBarOverlay: {
          height: ELECTRON_WINDOW_TITLE_BAR_HEIGHT,
        },
      };
  }
};
