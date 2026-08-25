import {
  ELECTRON_HOST_INVOKE_CHANNEL,
  ELECTRON_HOST_SHUTDOWN_MESSAGE,
  electronHostInvokeResponseSchema,
  type ElectronHostInvokeRequest,
  type ElectronHostInvokeResult,
  type OpenDucktorElectronApi,
} from "../shared/electron-bridge-contract";
import type { IpcRenderer } from "electron";

const ELECTRON_HOST_INVOKE_PROTOCOL_ERROR_MESSAGE =
  "Received an invalid host invoke response from the Electron main process.";

type ElectronIpcRendererLike = {
  invoke: IpcRenderer["invoke"];
};

const unwrapResponse = (response: unknown): ElectronHostInvokeResult => {
  const parsedResponse = electronHostInvokeResponseSchema.safeParse(response);
  if (!parsedResponse.success) {
    throw new Error(ELECTRON_HOST_INVOKE_PROTOCOL_ERROR_MESSAGE);
  }

  if (parsedResponse.data.status === "success") {
    return parsedResponse.data.payload;
  }

  throw new Error(ELECTRON_HOST_SHUTDOWN_MESSAGE);
};

export const createElectronHostInvoke =
  (ipcRenderer: ElectronIpcRendererLike): OpenDucktorElectronApi["invoke"] =>
  async (command, args) => {
    const request: ElectronHostInvokeRequest = args === undefined ? { command } : { command, args };
    const response: unknown = await ipcRenderer.invoke(ELECTRON_HOST_INVOKE_CHANNEL, request);
    return unwrapResponse(response);
  };
