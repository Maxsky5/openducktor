import { expect, mock, test } from "bun:test";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { registerElectronHostSelectionIpc } from "./electron-host-selection-ipc";

test("host selection clears notifications and reloads only the main frame", async () => {
  let handler!: Parameters<IpcMain["handle"]>[1];
  const clearNotifications = mock(() => {});
  const reload = mock(() => {
    expect(clearNotifications).toHaveBeenCalledTimes(1);
  });
  const frame = {};
  const sender = {
    mainFrame: frame,
    reload,
  };
  registerElectronHostSelectionIpc(
    {
      handle: (_channel, listener) => {
        handler = listener;
      },
    },
    () => false,
    clearNotifications,
  );
  // SAFETY: The handler reads only mainFrame, reload, and senderFrame.
  const event = {
    sender: sender as Electron.WebContents,
    senderFrame: frame,
  } as IpcMainInvokeEvent;
  await handler(event);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(clearNotifications).toHaveBeenCalledTimes(1);
  // SAFETY: A different frame exercises the main-frame ownership check before navigation.
  const subframe = { ...event, senderFrame: {} } as IpcMainInvokeEvent;
  expect(() => handler(subframe)).toThrow("main window");
  expect(reload).toHaveBeenCalledTimes(1);
  expect(clearNotifications).toHaveBeenCalledTimes(1);
});
