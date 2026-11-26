import { ELECTRON_SYSTEM_WAKE_CHANNEL } from "../shared/electron-bridge-contract";

type PowerEvents = { on(event: "resume" | "unlock-screen", listener: () => void): void };

type WakeWindow = {
  isDestroyed(): boolean;
  webContents: { isDestroyed(): boolean; send(channel: string): void };
};

/**
 * Tells each OpenDucktor window when the computer wakes from sleep or the screen unlocks. A read
 * that failed during sleep can then read again, also when the window kept its focus.
 */
export function forwardElectronSystemWake(
  powerMonitor: PowerEvents,
  getWindows: () => WakeWindow[],
): void {
  const notify = () => {
    for (const window of getWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
      window.webContents.send(ELECTRON_SYSTEM_WAKE_CHANNEL);
    }
  };
  powerMonitor.on("resume", notify);
  powerMonitor.on("unlock-screen", notify);
}
