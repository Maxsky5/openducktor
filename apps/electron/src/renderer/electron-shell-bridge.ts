import {
  type AgentSessionLiveEnvelope,
  type AppUpdateCommandResult,
  type AppUpdateState,
  agentSessionLiveEnvelopeSchema,
  appUpdateCommandResultSchema,
  appUpdateStateSchema,
} from "@openducktor/contracts";
import type { ShellBridge } from "@openducktor/frontend";
import { createHostClient } from "@openducktor/host-client";
import type { OpenDucktorElectronApi } from "../shared/electron-bridge-contract";

const RUN_EVENT_CHANNEL = "openducktor://run-event";
const DEV_SERVER_EVENT_CHANNEL = "openducktor://dev-server-event";
const TASK_EVENT_CHANNEL = "openducktor://task-event";
const AGENT_SESSION_LIVE_EVENT_CHANNEL = "openducktor://agent-session-live-event";
let nextDevServerTransportEpoch = 0;

const liveEnvelopeRepoPath = (envelope: AgentSessionLiveEnvelope): string => {
  switch (envelope.type) {
    case "snapshot":
    case "fault":
      return envelope.repoPath;
    case "session_upsert":
      return envelope.session.ref.repoPath;
    case "session_removed":
      return envelope.ref.repoPath;
    case "transcript_event":
      return envelope.event.sessionRef.repoPath;
    case "catalog_invalidated":
      return envelope.scope.repoPath;
  }
};

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
    observeAgentSessionLive: async (input, listener) => {
      let awaitingSnapshot = true;
      const unsubscribe = electronApi.subscribe(AGENT_SESSION_LIVE_EVENT_CHANNEL, (payload) => {
        const envelope = agentSessionLiveEnvelopeSchema.parse(payload);
        if (liveEnvelopeRepoPath(envelope) !== input.repoPath) {
          return;
        }
        if (envelope.type === "snapshot") {
          awaitingSnapshot = false;
          listener(envelope);
          return;
        }
        if (!awaitingSnapshot) {
          listener(envelope);
        }
      });
      try {
        await client.agentSessionLiveRefresh(input);
      } catch (cause) {
        unsubscribe();
        throw cause;
      }
      return unsubscribe;
    },
    subscribeTaskEvents: subscribeElectronEvent(electronApi, TASK_EVENT_CHANNEL),
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
  };
};
