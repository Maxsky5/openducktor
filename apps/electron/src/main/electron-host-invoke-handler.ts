import { ElectronValidationError } from "../effect/electron-errors";
import {
  ELECTRON_HOST_INVOKE_CHANNEL,
  type ElectronHostInvokeResponse,
} from "../shared/electron-bridge-contract";

type ElectronIpcMainLike = {
  handle(
    channel: string,
    listener: (event: unknown, request: unknown) => Promise<ElectronHostInvokeResponse>,
  ): void;
};

type ElectronHostInvokeHandlerOptions = {
  isHostShutdownStarted(): boolean;
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
};

type ValidatedElectronHostInvokeRequest = {
  command: string;
  args?: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readElectronHostInvokeRequest = (request: unknown): ValidatedElectronHostInvokeRequest => {
  if (!isRecord(request)) {
    throw new ElectronValidationError({
      operation: "electron.ipc.host-invoke.validate",
      message: "Electron host invoke request must be an object.",
      field: "request",
    });
  }
  if (typeof request.command !== "string") {
    throw new ElectronValidationError({
      operation: "electron.ipc.host-invoke.validate",
      message: "Electron host invoke command must be a string.",
      field: "command",
    });
  }
  if (request.args !== undefined && !isRecord(request.args)) {
    throw new ElectronValidationError({
      operation: "electron.ipc.host-invoke.validate",
      message: "Electron host invoke arguments must be an object when provided.",
      field: "args",
    });
  }

  return request.args === undefined
    ? { command: request.command }
    : { command: request.command, args: request.args };
};

export const registerElectronHostInvokeHandler = (
  ipcMain: ElectronIpcMainLike,
  options: ElectronHostInvokeHandlerOptions,
): void => {
  ipcMain.handle(ELECTRON_HOST_INVOKE_CHANNEL, async (_event, request) => {
    if (options.isHostShutdownStarted()) {
      return { status: "shutdown" };
    }

    const parsedRequest = readElectronHostInvokeRequest(request);
    const invocation = options.invoke(parsedRequest.command, parsedRequest.args);
    return { status: "success", payload: await invocation };
  });
};
