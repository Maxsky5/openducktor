import electron from "electron";
import {
  ELECTRON_HOST_EVENT_CHANNEL,
  ELECTRON_HOST_INVOKE_CHANNEL,
  ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL,
  ELECTRON_OPEN_EXTERNAL_URL_CHANNEL,
  type ElectronHostEventEnvelope,
  type OpenDucktorElectronApi,
} from "../shared/electron-bridge-contract";

const { contextBridge, ipcRenderer } = electron;

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
  openExternalUrl(url) {
    return ipcRenderer.invoke(ELECTRON_OPEN_EXTERNAL_URL_CHANNEL, url);
  },
  resolveLocalAttachmentPreviewSrc(path) {
    return ipcRenderer.invoke(ELECTRON_LOCAL_ATTACHMENT_PREVIEW_CHANNEL, path);
  },
};

contextBridge.exposeInMainWorld("openducktorElectron", electronApi);
