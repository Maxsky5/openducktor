import { expect, test } from "bun:test";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { registerElectronNativeThemeIpc } from "./electron-native-theme-ipc";

test("native theme IPC validates the theme and main-frame owner", () => {
  let handler!: Parameters<IpcMain["handle"]>[1];
  let shutdown = false;
  const theme = { themeSource: "system" } satisfies Parameters<
    typeof registerElectronNativeThemeIpc
  >[1];
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
  // SAFETY: The handler reads only sender.mainFrame and senderFrame.
  const event = { sender: { mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent;
  for (const value of ["light", "dark", "system"]) {
    handler(event, value);
    expect(theme.themeSource).toBe(value);
  }
  expect(() => handler(event, "invalid")).toThrow();
  expect(theme.themeSource).toBe("system");
  // SAFETY: A different frame exercises the owner check before applying the theme.
  expect(() => handler({ ...event, senderFrame: {} } as IpcMainInvokeEvent, "dark")).toThrow(
    "main window",
  );
  shutdown = true;
  expect(() => handler(event, "dark")).toThrow("shutting down");
  expect(theme.themeSource).toBe("system");
});
