import { hostInvokeFailureSchema } from "@openducktor/contracts";
import type { ShellBridge } from "@openducktor/frontend";
import {
  createAgentSessionLiveAttachment,
  createHostClient,
  HostInvokeError,
} from "@openducktor/host-client";
import {
  type OpenDucktorElectronApi,
  PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE,
} from "../shared/electron-bridge-contract";
import { createElectronTaskAssetUrl } from "../shared/electron-task-asset-url";

const RUN_EVENT_CHANNEL = "openducktor://run-event";
const DEV_SERVER_EVENT_CHANNEL = "openducktor://dev-server-event";
const AGENT_SESSION_LIVE_EVENT_CHANNEL = "openducktor://agent-session-live-event";
let nextDevServerTransportEpoch = 0;

export class ElectronPreloadBridgeUnavailableError extends Error {
  constructor() {
    super(
      "OpenDucktor Electron preload bridge is unavailable. Check that BrowserWindow webPreferences.preload points to the built preload.cjs file.",
    );
    this.name = "ElectronPreloadBridgeUnavailableError";
  }
}

export const getElectronApi = (): OpenDucktorElectronApi => {
  const electronApi = window.openducktorElectron;
  if (!electronApi) {
    throw new ElectronPreloadBridgeUnavailableError();
  }

  return electronApi;
};

const subscribeElectronEvent =
  (
    electronApi: OpenDucktorElectronApi,
    channel: typeof RUN_EVENT_CHANNEL,
  ): ShellBridge["subscribeRunEvents"] =>
  async (listener) =>
    electronApi.subscribe(channel, listener);

export const createElectronShellBridge = (): ShellBridge => {
  const electronApi = getElectronApi();
  const client = createHostClient(async (command, args, resultSchema) => {
    const response = await electronApi.invoke(command, args);
    if (response.ok) {
      return resultSchema.parse(response.value);
    }
    const failure = response.error.failure
      ? hostInvokeFailureSchema.parse(response.error.failure)
      : null;
    throw new HostInvokeError(response.error.message, failure);
  });

  return {
    client,
    capabilities: {
      canOpenExternalUrls: true,
      canPreviewLocalAttachments: true,
    },
    notifications: {
      getCapability: () => electronApi.notifications.getCapability(),
      requestPermission: () => electronApi.notifications.requestPermission(),
      isAppFocused: () => electronApi.notifications.isAppFocused(),
      withExternalDeliveryOwnership: async (_occurrenceId, dispatch) => dispatch(true),
      showOsNotification: (request) => electronApi.notifications.show(request),
      publishOccurrence: () => {},
      subscribeOccurrences: () => () => {},
      subscribeClicks: (listener) => electronApi.notifications.subscribeClicks(listener),
      dispose: () => {},
    },
    subscribeRunEvents: subscribeElectronEvent(electronApi, RUN_EVENT_CHANNEL),
    subscribeDevServerEvents: async (listener) => {
      const unsubscribe = electronApi.subscribe(DEV_SERVER_EVENT_CHANNEL, listener);
      const transportEpoch = `electron:${nextDevServerTransportEpoch}`;
      nextDevServerTransportEpoch += 1;
      return { transportEpoch, unsubscribe };
    },
    observeAgentSessionLive: async (input, listener) => {
      const attachment = createAgentSessionLiveAttachment(input.repoPath, listener);
      const unsubscribe = electronApi.subscribe(AGENT_SESSION_LIVE_EVENT_CHANNEL, (payload) => {
        attachment.accept(payload);
      });
      try {
        await client.agentSessionLiveRefresh(input);
      } catch (cause) {
        unsubscribe();
        throw cause;
      }
      return unsubscribe;
    },
    subscribeTaskStream: (input, onFrame, onTerminalFailure) =>
      electronApi.taskStream.subscribe(input, onFrame, onTerminalFailure),
    appUpdates: {
      getState: () => electronApi.appUpdates.getState(),
      check: (input) => electronApi.appUpdates.check(input),
      download: () => electronApi.appUpdates.download(),
      install: () => electronApi.appUpdates.install(),
      subscribeState: async (listener) =>
        electronApi.appUpdates.subscribe((state) => {
          listener(state);
        }),
    },
    openExternalUrl: (url) => electronApi.openExternalUrl(url),
    resolveLocalAttachmentPreviewSrc: (path) => electronApi.resolveLocalAttachmentPreviewSrc(path),
    resolveTaskAssetSrc: async (context) => createElectronTaskAssetUrl(context),
    editorClipboard: {
      readText(type) {
        if (type === undefined) return electronApi.editorClipboard.readText();
        if (type !== PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE) {
          throw new TypeError("Unsupported editor clipboard format.");
        }
        return electronApi.editorClipboard.readText(type);
      },
    },
    terminals: {
      connect: async (onFrame, onStateChange) => {
        const clientId = globalThis.crypto.randomUUID();
        const unsubscribe = electronApi.terminals.subscribe(clientId, onFrame);
        onStateChange("connected");
        return {
          send: (frame) => electronApi.terminals.send(clientId, frame),
          close: async () => {
            try {
              await electronApi.terminals.disconnect(clientId);
            } finally {
              unsubscribe();
              onStateChange("disconnected");
            }
          },
        };
      },
    },
  };
};
