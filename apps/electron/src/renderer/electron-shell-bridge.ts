import {
  type AppUpdateCommandResult,
  type AppUpdateState,
  agentSessionLiveEnvelopeSchema,
  appUpdateCommandResultSchema,
  appUpdateStateSchema,
  hostInvokeFailureSchema,
} from "@openducktor/contracts";
import type { ShellBridge } from "@openducktor/frontend";
import {
  createAgentSessionLiveAttachment,
  createHostClient,
  HostInvokeError,
} from "@openducktor/host-client";
import type { OpenDucktorElectronApi } from "../shared/electron-bridge-contract";

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

const readAppUpdateState = (value: unknown): AppUpdateState => appUpdateStateSchema.parse(value);

const readAppUpdateCommandResult = (value: unknown): AppUpdateCommandResult =>
  appUpdateCommandResultSchema.parse(value);

export const createElectronShellBridge = (): ShellBridge => {
  const electronApi = getElectronApi();
  const client = createHostClient(async (command, args) => {
    const response = await electronApi.invoke(command, args);
    if (response.ok) return response.value;
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
        attachment.accept(agentSessionLiveEnvelopeSchema.parse(payload));
      });
      try {
        await client.agentSessionLiveRefresh(input);
      } catch (cause) {
        unsubscribe();
        throw cause;
      }
      return unsubscribe;
    },
    subscribeTaskStream: (input, onFrame) => electronApi.taskStream.subscribe(input, onFrame),
    appUpdates: {
      getState: async () => readAppUpdateState(await electronApi.appUpdates.getState()),
      check: async (input) => readAppUpdateCommandResult(await electronApi.appUpdates.check(input)),
      download: async () => readAppUpdateCommandResult(await electronApi.appUpdates.download()),
      install: async () => readAppUpdateCommandResult(await electronApi.appUpdates.install()),
      subscribeState: async (listener) =>
        electronApi.appUpdates.subscribe((state) => {
          listener(readAppUpdateState(state));
        }),
    },
    openExternalUrl: (url) => electronApi.openExternalUrl(url),
    resolveLocalAttachmentPreviewSrc: (path) => electronApi.resolveLocalAttachmentPreviewSrc(path),
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
