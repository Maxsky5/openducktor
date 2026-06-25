import type { ShellBridge } from "@openducktor/frontend";
import { createHostClient } from "@openducktor/host-client";
import { ElectronValidationError } from "../effect/electron-errors";
import type { OpenDucktorElectronApi } from "../shared/electron-bridge-contract";

const RUN_EVENT_CHANNEL = "openducktor://run-event";
const DEV_SERVER_EVENT_CHANNEL = "openducktor://dev-server-event";
const TASK_EVENT_CHANNEL = "openducktor://task-event";
const CODEX_APP_SERVER_EVENT_CHANNEL = "openducktor://codex-app-server-event";

const getElectronApi = (): OpenDucktorElectronApi => {
  const electronApi = window.openducktorElectron;
  if (!electronApi) {
    throw new ElectronValidationError({
      operation: "electron.renderer.get-preload-bridge",
      message:
        "OpenDucktor Electron preload bridge is unavailable. Check that BrowserWindow webPreferences.preload points to the built preload.cjs file.",
    });
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
    subscribeDevServerEvents: subscribeElectronEvent(electronApi, DEV_SERVER_EVENT_CHANNEL),
    subscribeTaskEvents: subscribeElectronEvent(electronApi, TASK_EVENT_CHANNEL),
    subscribeCodexAppServerEvents: subscribeElectronEvent(
      electronApi,
      CODEX_APP_SERVER_EVENT_CHANNEL,
    ),
    openExternalUrl: (url) => electronApi.openExternalUrl(url),
    resolveLocalAttachmentPreviewSrc: (path) => electronApi.resolveLocalAttachmentPreviewSrc(path),
  };
};
