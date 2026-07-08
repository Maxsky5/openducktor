import type { ShellBridge } from "@openducktor/frontend";
import { createHostClient } from "@openducktor/host-client";
import type { OpenDucktorElectronApi } from "../shared/electron-bridge-contract";

const RUN_EVENT_CHANNEL = "openducktor://run-event";
const DEV_SERVER_EVENT_CHANNEL = "openducktor://dev-server-event";
const TASK_EVENT_CHANNEL = "openducktor://task-event";
const CODEX_APP_SERVER_EVENT_CHANNEL = "openducktor://codex-app-server-event";
let nextDevServerTransportEpoch = 0;

export class ElectronPreloadBridgeUnavailableError extends Error {
  constructor() {
    super(
      "OpenDucktor Electron preload bridge is unavailable. Check that BrowserWindow webPreferences.preload points to the built preload.cjs file.",
    );
    this.name = "ElectronPreloadBridgeUnavailableError";
  }
}

const getElectronApi = (): OpenDucktorElectronApi => {
  const electronApi = window.openducktorElectron;
  if (!electronApi) {
    throw new ElectronPreloadBridgeUnavailableError();
  }

  return electronApi;
};

const subscribeElectronEvent =
  (electronApi: OpenDucktorElectronApi, channel: string): ShellBridge["subscribeRunEvents"] =>
  async (listener) =>
    electronApi.subscribe(channel, listener);

export const createElectronShellBridge = (): ShellBridge => {
  const electronApi = getElectronApi();
  const client = createHostClient((command, args) => electronApi.invoke(command, args));

  return {
    client,
    capabilities: {
      canOpenExternalUrls: true,
      canPreviewLocalAttachments: true,
    },
    subscribeRunEvents: subscribeElectronEvent(electronApi, RUN_EVENT_CHANNEL),
    subscribeDevServerEvents: async (listener) => {
      const unsubscribe = electronApi.subscribe(DEV_SERVER_EVENT_CHANNEL, listener);
      const transportEpoch = `electron:${nextDevServerTransportEpoch}`;
      nextDevServerTransportEpoch += 1;
      return { transportEpoch, unsubscribe };
    },
    subscribeTaskEvents: subscribeElectronEvent(electronApi, TASK_EVENT_CHANNEL),
    subscribeCodexAppServerEvents: subscribeElectronEvent(
      electronApi,
      CODEX_APP_SERVER_EVENT_CHANNEL,
    ),
    appUpdates: {
      getState: () => electronApi.appUpdates.getState(),
      check: (input) => electronApi.appUpdates.check(input),
      download: () => electronApi.appUpdates.download(),
      install: () => electronApi.appUpdates.install(),
      subscribeState: async (listener) => electronApi.appUpdates.subscribe(listener),
    },
    openExternalUrl: (url) => electronApi.openExternalUrl(url),
    resolveLocalAttachmentPreviewSrc: (path) => electronApi.resolveLocalAttachmentPreviewSrc(path),
  };
};
