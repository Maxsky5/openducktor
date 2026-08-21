import {
  type JsonValue,
  appPlatformSchema,
  appUpdateCommandResultSchema,
  appUpdateStateSchema,
} from "@openducktor/contracts";
import electron from "electron";
import {
  ELECTRON_APP_UPDATE_CHECK_CHANNEL,
  ELECTRON_APP_UPDATE_DOWNLOAD_CHANNEL,
  ELECTRON_APP_UPDATE_GET_STATE_CHANNEL,
  ELECTRON_APP_UPDATE_INSTALL_CHANNEL,
  ELECTRON_APP_UPDATE_STATE_CHANGED_CHANNEL,
  ELECTRON_EDITOR_CLIPBOARD_READ_CHANNEL,
  ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL,
  ELECTRON_OPEN_EXTERNAL_URL_CHANNEL,
  ELECTRON_TERMINAL_DISCONNECT_CHANNEL,
  ELECTRON_TERMINAL_EVENT_CHANNEL,
  ELECTRON_TERMINAL_SEND_CHANNEL,
  type ElectronAppUpdateCheckInput,
  electronTerminalEventEnvelopeSchema,
  type ElectronTerminalEventEnvelope,
  type OpenDucktorElectronApi,
  type OpenDucktorElectronAppUpdateApi,
  type OpenDucktorElectronTerminalApi,
} from "../shared/electron-bridge-contract";
import { createElectronHostInvoke } from "./electron-host-invoke";
import { subscribeElectronHostEvent } from "./electron-host-events";
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
    const handleEvent = (_event: Electron.IpcRendererEvent, state: JsonValue | undefined) => {
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
    const handleEvent = (
      _event: Electron.IpcRendererEvent,
      value: ElectronTerminalEventEnvelope | JsonValue | undefined,
    ) => {
      const parsedEnvelope = electronTerminalEventEnvelopeSchema.safeParse(value);
      if (parsedEnvelope.success && parsedEnvelope.data.clientId === clientId) {
        listener(parsedEnvelope.data.frame);
      }
    };
    ipcRenderer.on(ELECTRON_TERMINAL_EVENT_CHANNEL, handleEvent);
    return () => ipcRenderer.off(ELECTRON_TERMINAL_EVENT_CHANNEL, handleEvent);
  },
};

const electronApi: OpenDucktorElectronApi = {
  platform: appPlatformSchema.parse(process.platform),
  invoke: invokeHost,
  subscribe(channel, listener) {
    return subscribeElectronHostEvent(ipcRenderer, channel, listener);
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
  editorClipboard: {
    readText(type) {
      return ipcRenderer.invoke(ELECTRON_EDITOR_CLIPBOARD_READ_CHANNEL, type);
    },
  },
};

contextBridge.exposeInMainWorld("openducktorElectron", electronApi);
