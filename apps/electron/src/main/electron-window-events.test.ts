import { expect, mock, test } from "bun:test";
import { ELECTRON_SYSTEM_WAKE_CHANNEL } from "../shared/electron-bridge-contract";
import { createWindowEventSender, forwardSystemWake } from "./electron-window-events";

const createWindow = ({ destroyed = false, fails = false } = {}) => ({
  isDestroyed: () => destroyed,
  webContents: {
    isDestroyed: () => false,
    send: mock((..._message: unknown[]) => {
      if (fails) throw new Error("render frame disposed");
    }),
  },
});

test("an event reaches each open window, and a failed window does not stop the others", () => {
  const failing = createWindow({ fails: true });
  const closed = createWindow({ destroyed: true });
  const open = createWindow();
  const failures: [string, unknown][] = [];
  const send = createWindowEventSender(
    () => [failing, closed, open],
    (channel, cause) => failures.push([channel, cause]),
  );

  send("openducktor:update", { status: "idle" });

  expect(open.webContents.send.mock.calls).toEqual([["openducktor:update", { status: "idle" }]]);
  expect(closed.webContents.send).not.toHaveBeenCalled();
  expect(failures).toEqual([["openducktor:update", new Error("render frame disposed")]]);
});

test("a wake and a screen unlock each send the wake event", () => {
  const listeners = new Map<string, () => void>();
  const send = mock((..._event: unknown[]) => {});
  forwardSystemWake({ on: (event, listener) => listeners.set(event, listener) }, send);

  listeners.get("resume")?.();
  listeners.get("unlock-screen")?.();

  expect(send.mock.calls).toEqual([[ELECTRON_SYSTEM_WAKE_CHANNEL], [ELECTRON_SYSTEM_WAKE_CHANNEL]]);
});
