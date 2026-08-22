import { errorMessage, ElectronValidationError } from "../effect/electron-errors";
import {
  ELECTRON_HOST_INVOKE_CHANNEL,
  type ElectronHostInvokeResponse,
} from "../shared/electron-bridge-contract";
import { jsonValueSchema, type JsonValue, hasRuntimeType } from "@openducktor/contracts";
import { hostInvokeFailureFromError, parseHostCommandResponse } from "@openducktor/host";
import type { IpcMainInvokeEvent } from "electron";
import type { UnvalidatedElectronHostInvokeResult } from "./electron-host-invoke";

type ElectronIpcMainLike = {
  handle(
    channel: string,
    listener: (
      event: IpcMainInvokeEvent,
      request: Parameters<typeof jsonValueSchema.safeParse>[0],
    ) => Promise<ElectronHostInvokeResponse>,
  ): void;
};

type ElectronHostInvokeHandlerOptions = {
  isHostShutdownStarted(): boolean;
  invoke(
    command: string,
    args?: Record<string, JsonValue>,
  ): Promise<UnvalidatedElectronHostInvokeResult>;
};

type ValidatedElectronHostInvokeRequest = {
  command: string;
  args?: Record<string, JsonValue>;
};

const isRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readElectronHostInvokeRequest = (
  request: Parameters<typeof jsonValueSchema.safeParse>[0],
): ValidatedElectronHostInvokeRequest => {
  const parsedRequest = jsonValueSchema.safeParse(request);
  if (!parsedRequest.success || !isRecord(parsedRequest.data)) {
    throw new ElectronValidationError({
      operation: "electron.ipc.host-invoke.validate",
      message: "Electron host invoke request must be an object.",
      field: "request",
    });
  }
  if (!hasRuntimeType(parsedRequest.data.command, "string")) {
    throw new ElectronValidationError({
      operation: "electron.ipc.host-invoke.validate",
      message: "Electron host invoke command must be a string.",
      field: "command",
    });
  }
  if (parsedRequest.data.args !== undefined && !isRecord(parsedRequest.data.args)) {
    throw new ElectronValidationError({
      operation: "electron.ipc.host-invoke.validate",
      message: "Electron host invoke arguments must be an object when provided.",
      field: "args",
    });
  }

  return parsedRequest.data.args === undefined
    ? { command: parsedRequest.data.command }
    : { command: parsedRequest.data.command, args: parsedRequest.data.args };
};

const validateElectronHostInvokeResult = (
  command: string,
  result: UnvalidatedElectronHostInvokeResult,
): ElectronHostInvokeResponse => {
  if (!result.ok) {
    return { status: "success", payload: result };
  }

  try {
    return {
      status: "success",
      payload: { ok: true, value: parseHostCommandResponse(command, result.value) },
    };
  } catch (cause) {
    const failure = hostInvokeFailureFromError(cause);
    return {
      status: "success",
      payload: {
        ok: false,
        error: {
          message: errorMessage(cause),
          ...(() => {
            if (failure) {
              return { failure };
            }
            return {};
          })(),
        },
      },
    };
  }
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
    return validateElectronHostInvokeResult(
      parsedRequest.command,
      await options.invoke(parsedRequest.command, parsedRequest.args),
    );
  });
};
