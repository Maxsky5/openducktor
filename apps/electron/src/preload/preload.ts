import { appUpdateCommandResultSchema, appUpdateStateSchema } from "@openducktor/contracts";
import electron from "electron";
import {
  ELECTRON_APP_UPDATE_CHECK_CHANNEL,
  ELECTRON_APP_UPDATE_DOWNLOAD_CHANNEL,
  ELECTRON_APP_UPDATE_GET_STATE_CHANNEL,
  ELECTRON_APP_UPDATE_INSTALL_CHANNEL,
  ELECTRON_APP_UPDATE_STATE_CHANGED_CHANNEL,
  ELECTRON_HOST_EVENT_CHANNEL,
  ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL,
  ELECTRON_OPEN_EXTERNAL_URL_CHANNEL,
  ELECTRON_TERMINAL_DISCONNECT_CHANNEL,
  ELECTRON_TERMINAL_EVENT_CHANNEL,
  ELECTRON_TERMINAL_SEND_CHANNEL,
  type ElectronAppUpdateCheckInput,
  type ElectronHostEventEnvelope,
  type ElectronTerminalEventEnvelope,
  type OpenDucktorElectronApi,
  type OpenDucktorElectronAppUpdateApi,
  type OpenDucktorElectronTerminalApi,
} from "../shared/electron-bridge-contract";
import { createElectronHostInvoke } from "./electron-host-invoke";
import { createElectronTaskStreamApi } from "./electron-task-stream-ipc";

const { contextBridge, ipcRenderer } = electron;
const invokeHost = createElectronHostInvoke(ipcRenderer);
const taskStream = createElectronTaskStreamApi(ipcRenderer);

const appUpdates: OpenDucktorElectronAppUpdateApi = {
  async getState() {
    return appUpdateStateSchema.parse(
      await ipcRenderer.invoke(ELECTRON_APP_UPDATE_GET_STATE_CHANNEL),
    );
  },
  async check(input: ElectronAppUpdateCheckInput) {
    return appUpdateCommandResultSchema.parse(
      await ipcRenderer.invoke(ELECTRON_APP_UPDATE_CHECK_CHANNEL, input),
    );
  },
  async download() {
    return appUpdateCommandResultSchema.parse(
      await ipcRenderer.invoke(ELECTRON_APP_UPDATE_DOWNLOAD_CHANNEL),
    );
  },
  async install() {
    return appUpdateCommandResultSchema.parse(
      await ipcRenderer.invoke(ELECTRON_APP_UPDATE_INSTALL_CHANNEL),
    );
  },
  subscribe(listener) {
    const handleEvent = (_event: Electron.IpcRendererEvent, state: unknown) => {
      const parsedState = appUpdateStateSchema.safeParse(state);
      if (!parsedState.success) {
        console.error("Received invalid app update state from Electron main process.", {
          issues: parsedState.error.issues,
        });
        return;
      }
      listener(parsedState.data);
    };

    ipcRenderer.on(ELECTRON_APP_UPDATE_STATE_CHANGED_CHANNEL, handleEvent);

    return () => {
      ipcRenderer.off(ELECTRON_APP_UPDATE_STATE_CHANGED_CHANNEL, handleEvent);
    };
  },
};

const terminals: OpenDucktorElectronTerminalApi = {
  async send(clientId, frame) {
    await ipcRenderer.invoke(ELECTRON_TERMINAL_SEND_CHANNEL, { clientId, frame });
  },
  async disconnect(clientId) {
    await ipcRenderer.invoke(ELECTRON_TERMINAL_DISCONNECT_CHANNEL, clientId);
  },
  subscribe(clientId, listener) {
    const handleEvent = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const envelope = value as Partial<ElectronTerminalEventEnvelope>;
      if (envelope.clientId === clientId && envelope.frame instanceof Uint8Array) {
        listener(envelope.frame);
      }
    };
    ipcRenderer.on(ELECTRON_TERMINAL_EVENT_CHANNEL, handleEvent);
    return () => ipcRenderer.off(ELECTRON_TERMINAL_EVENT_CHANNEL, handleEvent);
  },
};

const electronApi: OpenDucktorElectronApi = {
  invoke: invokeHost,
  subscribe(channel, listener) {
    const handleEvent = (
      _event: Electron.IpcRendererEvent,
      envelope: ElectronHostEventEnvelope,
    ) => {
      if (envelope.channel === channel) {
        listener(envelope.payload);
      }
    };

    ipcRenderer.on(ELECTRON_HOST_EVENT_CHANNEL, handleEvent);

    return () => {
      ipcRenderer.off(ELECTRON_HOST_EVENT_CHANNEL, handleEvent);
    };
  },
  appUpdates,
  openExternalUrl(url) {
    return ipcRenderer.invoke(ELECTRON_OPEN_EXTERNAL_URL_CHANNEL, url);
  },
  resolveLocalAttachmentPreviewSrc(path) {
    return ipcRenderer.invoke(ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL, path);
  },
  terminals,
  taskStream,
};

contextBridge.exposeInMainWorld("openducktorElectron", electronApi);
