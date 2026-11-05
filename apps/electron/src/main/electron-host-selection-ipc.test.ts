import { expect, mock, test } from "bun:test";
import {
  type HostSelectionIpcHandler,
  registerElectronHostSelectionIpc,
} from "./electron-host-selection-ipc";

test("host selection clears notifications and reloads only the main frame", async () => {
  let handler!: HostSelectionIpcHandler;
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
  const event = { sender, senderFrame: frame };
  handler(event);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(clearNotifications).toHaveBeenCalledTimes(1);
  // A different frame exercises the main-frame ownership check before navigation.
  const subframe = { ...event, senderFrame: {} };
  expect(() => handler(subframe)).toThrow("main window");
  expect(reload).toHaveBeenCalledTimes(1);
  expect(clearNotifications).toHaveBeenCalledTimes(1);
});
