import { ELECTRON_SYSTEM_WAKE_CHANNEL } from "../shared/electron-bridge-contract";

type EventWindow = {
  isDestroyed(): boolean;
  webContents: { isDestroyed(): boolean; send(channel: string, ...args: unknown[]): void };
};

type PowerEvents = { on(event: "resume" | "unlock-screen", listener: () => void): void };

export type WindowEventSender = (channel: string, ...args: unknown[]) => void;

/** Sends an event to each open window. A window that cannot take it does not stop the others. */
export const createWindowEventSender =
  (
    getWindows: () => EventWindow[],
    reportFailure: (channel: string, cause: unknown) => void,
  ): WindowEventSender =>
  (channel, ...args) => {
    for (const window of getWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
      try {
        window.webContents.send(channel, ...args);
      } catch (cause) {
        reportFailure(channel, cause);
      }
    }
  };

/** Tells each window when the computer wakes from sleep or the screen unlocks. */
export const forwardSystemWake = (powerMonitor: PowerEvents, send: WindowEventSender): void => {
  const notify = () => send(ELECTRON_SYSTEM_WAKE_CHANNEL);
  powerMonitor.on("resume", notify);
  powerMonitor.on("unlock-screen", notify);
};
