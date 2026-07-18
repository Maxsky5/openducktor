import type { HostCommandName } from "@openducktor/host";
import {
  ELECTRON_HOST_INVOKE_CHANNEL,
  type ElectronHostInvokeRequest,
  type ElectronHostInvokeResponse,
} from "../shared/electron-bridge-contract";

type ElectronIpcMainLike = {
  handle(
    channel: string,
    listener: (
      event: unknown,
      request: ElectronHostInvokeRequest,
    ) => Promise<ElectronHostInvokeResponse>,
  ): void;
};

type ElectronHostInvokeHandlerOptions = {
  isHostShutdownStarted(): boolean;
  invoke(command: HostCommandName, args?: Record<string, unknown>): Promise<unknown>;
};

export const registerElectronHostInvokeHandler = (
  ipcMain: ElectronIpcMainLike,
  options: ElectronHostInvokeHandlerOptions,
): void => {
  ipcMain.handle(ELECTRON_HOST_INVOKE_CHANNEL, async (_event, request) => {
    if (options.isHostShutdownStarted()) {
      return { status: "shutdown" };
    }

    const invocation = options.invoke(request.command, request.args);
    return { status: "success", payload: await invocation };
  });
};
