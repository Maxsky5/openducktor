import { themePreferenceSchema, type ThemePreference } from "@openducktor/contracts";
import { ELECTRON_NATIVE_THEME_CHANNEL } from "../shared/electron-bridge-contract";

/** The invoke event fields that the theme handler reads. */
type NativeThemeEvent = { sender: { mainFrame: object }; senderFrame: object | null };

export type NativeThemeIpcHandler = (event: NativeThemeEvent, theme: ThemePreference) => void;

export function registerElectronNativeThemeIpc(
  ipc: { handle(channel: string, listener: NativeThemeIpcHandler): void },
  nativeTheme: { themeSource: ThemePreference },
  isShutdown: () => boolean,
): void {
  ipc.handle(ELECTRON_NATIVE_THEME_CHANNEL, (event, theme) => {
    if (isShutdown()) throw new Error("OpenDucktor is shutting down.");
    if (event.senderFrame !== event.sender.mainFrame)
      throw new Error("Change the theme from the main window.");
    nativeTheme.themeSource = themePreferenceSchema.unwrap().parse(theme);
  });
}
