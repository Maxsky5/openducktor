import { expect, test } from "bun:test";
import type { ThemePreference } from "@openducktor/contracts";
import {
  type NativeThemeIpcHandler,
  registerElectronNativeThemeIpc,
} from "./electron-native-theme-ipc";

test("native theme IPC validates the theme and main-frame owner", () => {
  let handler!: NativeThemeIpcHandler;
  let shutdown = false;
  const theme: Parameters<typeof registerElectronNativeThemeIpc>[1] = { themeSource: "system" };
  registerElectronNativeThemeIpc(
    {
      handle: (_channel, listener) => {
        handler = listener;
      },
    },
    theme,
    () => shutdown,
  );
  const frame = {};
  const event = { sender: { mainFrame: frame }, senderFrame: frame };
  for (const value of ["light", "dark", "system"] satisfies ThemePreference[]) {
    handler(event, value);
    expect(theme.themeSource).toBe(value);
  }
  // SAFETY: an invalid theme from the renderer exercises the handler's validation.
  expect(() => handler(event, "invalid" as ThemePreference)).toThrow();
  expect(theme.themeSource).toBe("system");
  // A different frame exercises the owner check before applying the theme.
  expect(() => handler({ ...event, senderFrame: {} }, "dark")).toThrow("main window");
  shutdown = true;
  expect(() => handler(event, "dark")).toThrow("shutting down");
  expect(theme.themeSource).toBe("system");
});
