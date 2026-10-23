import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { ElectronValidationError } from "../effect/electron-errors";

/** Check the current main frame on every call, including calls to handlers added after startup. */
export const createMainWindowIpcRegistrar = (
  ipcMain: Pick<IpcMain, "handle">,
  isMainWindow: (sender: WebContents) => boolean,
): Pick<IpcMain, "handle"> => ({
  handle(channel, listener) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const { sender, senderFrame } = event;
      if (
        sender.isDestroyed() ||
        !isMainWindow(sender) ||
        !senderFrame ||
        senderFrame.isDestroyed() ||
        senderFrame !== sender.mainFrame ||
        senderFrame.processId !== event.processId ||
        senderFrame.routingId !== event.frameId
      ) {
        throw new ElectronValidationError({
          operation: channel,
          field: "senderFrame",
          message: "Run this action from the active OpenDucktor main window.",
        });
      }
      return listener(event, ...args);
    });
  },
});
