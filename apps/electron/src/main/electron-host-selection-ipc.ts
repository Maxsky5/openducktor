import type { IpcMain } from "electron";
import { ELECTRON_HOST_SELECT_CHANNEL } from "../shared/electron-bridge-contract";

/** Reload only the existing renderer entry point; the host and its work keep running. */
export function registerElectronHostSelectionIpc(
  ipc: Pick<IpcMain, "handle">,
  isShutdown: () => boolean,
  clearNotifications: () => void,
): void {
  ipc.handle(ELECTRON_HOST_SELECT_CHANNEL, (event) => {
    if (isShutdown()) throw new Error("OpenDucktor is shutting down.");
    if (event.senderFrame !== event.sender.mainFrame)
      throw new Error("Select a host from the main window.");
    clearNotifications();
    event.sender.reload();
  });
}
