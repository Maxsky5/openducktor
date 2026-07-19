import {
  ELECTRON_HOST_INVOKE_CHANNEL,
  ELECTRON_HOST_SHUTDOWN_MESSAGE,
  type ElectronHostInvokeRequest,
  type ElectronHostInvokeResult,
  type OpenDucktorElectronApi,
} from "../shared/electron-bridge-contract";

const ELECTRON_HOST_INVOKE_PROTOCOL_ERROR_MESSAGE =
  "Received an invalid host invoke response from the Electron main process.";

type ElectronIpcRendererLike = {
  invoke(channel: string, request: ElectronHostInvokeRequest): Promise<unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isElectronHostInvokeResult = (value: unknown): value is ElectronHostInvokeResult => {
  if (!isRecord(value) || typeof value.ok !== "boolean") return false;
  if (value.ok) return Object.hasOwn(value, "value");
  return isRecord(value.error) && typeof value.error.message === "string";
};

const unwrapResponse = (response: unknown): ElectronHostInvokeResult => {
  if (!isRecord(response) || !Object.hasOwn(response, "status")) {
    throw new Error(ELECTRON_HOST_INVOKE_PROTOCOL_ERROR_MESSAGE);
  }

  if (response.status === "success" && isElectronHostInvokeResult(response.payload)) {
    return response.payload;
  }

  if (response.status === "shutdown" && !Object.hasOwn(response, "payload")) {
    throw new Error(ELECTRON_HOST_SHUTDOWN_MESSAGE);
  }

  throw new Error(ELECTRON_HOST_INVOKE_PROTOCOL_ERROR_MESSAGE);
};

export const createElectronHostInvoke =
  (ipcRenderer: ElectronIpcRendererLike): OpenDucktorElectronApi["invoke"] =>
  async (command, args) => {
    const request: ElectronHostInvokeRequest = args === undefined ? { command } : { command, args };
    return unwrapResponse(await ipcRenderer.invoke(ELECTRON_HOST_INVOKE_CHANNEL, request));
  };
