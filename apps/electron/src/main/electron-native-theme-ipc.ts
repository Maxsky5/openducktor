import type { IpcMain } from "electron";
import { themePreferenceSchema, type ThemePreference } from "@openducktor/contracts";
import { ELECTRON_NATIVE_THEME_CHANNEL } from "../shared/electron-bridge-contract";

export function registerElectronNativeThemeIpc(
  ipc: Pick<IpcMain, "handle">,
  nativeTheme: { themeSource: ThemePreference },
  isShutdown: () => boolean,
): void {
  ipc.handle(ELECTRON_NATIVE_THEME_CHANNEL, (event, theme: ThemePreference) => {
    if (isShutdown()) throw new Error("OpenDucktor is shutting down.");
    if (event.senderFrame !== event.sender.mainFrame)
      throw new Error("Change the theme from the main window.");
    nativeTheme.themeSource = themePreferenceSchema.unwrap().parse(theme);
  });
}
