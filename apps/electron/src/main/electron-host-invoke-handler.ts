import { ElectronValidationError, jsonIssues } from "../effect/electron-errors";
import {
  ELECTRON_HOST_INVOKE_CHANNEL,
  electronHostInvokeRequestSchema,
  type ElectronHostInvokeRequest,
  type ElectronHostInvokeResult,
  type ElectronHostInvokeWireResponse,
} from "../shared/electron-bridge-contract";
import type { IpcMainInvokeEvent } from "electron";

type ElectronIpcMainLike = {
  handle(
    channel: string,
    listener: (
      event: IpcMainInvokeEvent,
      request: unknown,
    ) => Promise<ElectronHostInvokeWireResponse>,
  ): void;
};

type ElectronHostInvokeHandlerOptions = {
  isHostShutdownStarted(): boolean;
  invoke(command: string, args?: Record<string, unknown>): Promise<ElectronHostInvokeResult>;
};

const readElectronHostInvokeRequest = (request: unknown): ElectronHostInvokeRequest => {
  const parsedRequest = electronHostInvokeRequestSchema.safeParse(request);
  if (parsedRequest.success) return parsedRequest.data;
  let field = "request";
  let message = "Electron host invoke request must be an object.";
  const hasRootIssue = parsedRequest.error.issues.some((issue) => issue.path.length === 0);
  if (!hasRootIssue && parsedRequest.error.issues.some((issue) => issue.path[0] === "command")) {
    field = "command";
    message = "Electron host invoke command must be a string.";
  } else if (
    !hasRootIssue &&
    parsedRequest.error.issues.some((issue) => issue.path[0] === "args")
  ) {
    field = "args";
    message = "Electron host invoke arguments must be an object when provided.";
  }
  throw new ElectronValidationError({
    operation: "electron.ipc.host-invoke.validate",
    message,
    field,
    details: { issues: jsonIssues(parsedRequest.error.issues) },
  });
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
    return {
      status: "success",
      payload: await options.invoke(parsedRequest.command, parsedRequest.args),
    };
  });
};
