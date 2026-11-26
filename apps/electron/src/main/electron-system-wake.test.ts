import { expect, mock, test } from "bun:test";
import { ELECTRON_SYSTEM_WAKE_CHANNEL } from "../shared/electron-bridge-contract";
import { forwardElectronSystemWake } from "./electron-system-wake";

const createWindow = (destroyed = false) => ({
  isDestroyed: () => destroyed,
  webContents: { isDestroyed: () => false, send: mock((_channel: string) => {}) },
});

test("a wake or a screen unlock reaches each open window", () => {
  const listeners = new Map<string, () => void>();
  const open = createWindow();
  const closed = createWindow(true);
  forwardElectronSystemWake({ on: (event, listener) => listeners.set(event, listener) }, () => [
    open,
    closed,
  ]);

  listeners.get("resume")?.();
  listeners.get("unlock-screen")?.();

  expect(open.webContents.send.mock.calls).toEqual([
    [ELECTRON_SYSTEM_WAKE_CHANNEL],
    [ELECTRON_SYSTEM_WAKE_CHANNEL],
  ]);
  expect(closed.webContents.send).not.toHaveBeenCalled();
});
