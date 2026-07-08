import electron from "electron";
import {
  ELECTRON_APP_UPDATE_CHECK_CHANNEL,
  ELECTRON_APP_UPDATE_DOWNLOAD_CHANNEL,
  ELECTRON_APP_UPDATE_GET_STATE_CHANNEL,
  ELECTRON_APP_UPDATE_INSTALL_CHANNEL,
  ELECTRON_APP_UPDATE_STATE_CHANGED_CHANNEL,
  ELECTRON_HOST_EVENT_CHANNEL,
  ELECTRON_HOST_INVOKE_CHANNEL,
  ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL,
  ELECTRON_OPEN_EXTERNAL_URL_CHANNEL,
  type ElectronAppUpdateCheckInput,
  type ElectronHostEventEnvelope,
  type OpenDucktorElectronApi,
  type OpenDucktorElectronAppUpdateApi,
} from "../shared/electron-bridge-contract";

const { contextBridge, ipcRenderer } = electron;

const appUpdates: OpenDucktorElectronAppUpdateApi = {
  getState() {
    return ipcRenderer.invoke(ELECTRON_APP_UPDATE_GET_STATE_CHANNEL);
  },
  check(input: ElectronAppUpdateCheckInput) {
    return ipcRenderer.invoke(ELECTRON_APP_UPDATE_CHECK_CHANNEL, input);
  },
  download() {
    return ipcRenderer.invoke(ELECTRON_APP_UPDATE_DOWNLOAD_CHANNEL);
  },
  install() {
    return ipcRenderer.invoke(ELECTRON_APP_UPDATE_INSTALL_CHANNEL);
  },
  subscribe(listener) {
    const handleEvent = (_event: Electron.IpcRendererEvent, state: unknown) => {
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(ELECTRON_APP_UPDATE_STATE_CHANGED_CHANNEL, handleEvent);

    return () => {
      ipcRenderer.off(ELECTRON_APP_UPDATE_STATE_CHANGED_CHANNEL, handleEvent);
    };
  },
};

const electronApi: OpenDucktorElectronApi = {
  invoke(command, args) {
    return ipcRenderer.invoke(ELECTRON_HOST_INVOKE_CHANNEL, {
      command,
      args,
    });
  },
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
};

contextBridge.exposeInMainWorld("openducktorElectron", electronApi);
