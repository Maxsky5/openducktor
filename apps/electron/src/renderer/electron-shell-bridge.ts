import {
  hostInvokeFailureSchema,
  themePreferenceSchema,
  type HostEventPayload,
  type ThemePreference,
} from "@openducktor/contracts";
import type { ShellBridge } from "@openducktor/frontend";
import { logListenerFailure } from "@openducktor/frontend-core/connection/host-connection";
import {
  createAgentSessionLiveAttachment,
  createHostClient,
  HostInvokeError,
  type HostClient,
} from "@openducktor/host-client";
import {
  type OpenDucktorElectronApi,
  type OpenDucktorElectronTerminalApi,
  PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE,
} from "../shared/electron-bridge-contract";
import { electronBrowserPartition } from "../shared/electron-browser-partitions";
import { createElectronTaskAssetUrl } from "../shared/electron-task-asset-url";

const RUN_EVENT_CHANNEL = "openducktor://run-event";
const BROWSER_EVENT_CHANNEL = "openducktor://browser-event";
const AGENT_SESSION_LIVE_EVENT_CHANNEL = "openducktor://agent-session-live-event";
const AZURE_DEVOPS_CONNECTION_EVENT_CHANNEL = "openducktor://azure-devops-connection-updated";
const RUNTIME_CHANGED_EVENT_CHANNEL = "openducktor://runtime-changed";
const TASK_MERGE_STATUS_EVENT_CHANNEL = "openducktor://task-merge-status-updated";

export function withElectronNativeTheme(
  client: HostClient,
  applyTheme: (theme: ThemePreference) => Promise<void>,
): HostClient {
  const themed: Pick<HostClient, "workspaceGetSettingsSnapshot" | "setTheme"> = {
    async workspaceGetSettingsSnapshot() {
      const snapshot = await client.workspaceGetSettingsSnapshot();
      await applyTheme(snapshot.theme);
      return snapshot;
    },
    async setTheme(theme) {
      await client.setTheme(theme);
      await applyTheme(themePreferenceSchema.unwrap().parse(theme));
    },
  };
  // The host client methods are not enumerable, so a spread would drop them.
  // SAFETY: The prototype is `client`, so the object has every host client method.
  return Object.assign(Object.create(client) as HostClient, themed);
}

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
    electronApi.subscribe(channel, (payload: HostEventPayload<typeof RUN_EVENT_CHANNEL>) =>
      logListenerFailure(listener(payload)),
    );

/**
 * Opens one client of a frame channel. A channel with a `connect` step must accept the client
 * before the client counts as connected.
 */
const connectFrameChannel = async (
  channel: OpenDucktorElectronTerminalApi & { connect?(clientId: string): Promise<void> },
  onFrame: (frame: Uint8Array) => void,
  onStateChange: (state: "connected" | "disconnected") => void,
) => {
  const clientId = globalThis.crypto.randomUUID();
  const unsubscribe = channel.subscribe(clientId, onFrame);
  try {
    await channel.connect?.(clientId);
  } catch (cause) {
    unsubscribe();
    throw cause;
  }
  onStateChange("connected");
  return {
    send: (frame: Uint8Array) => channel.send(clientId, frame),
    close: async () => {
      try {
        await channel.disconnect(clientId);
      } finally {
        unsubscribe();
        onStateChange("disconnected");
      }
    },
  };
};

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
    remoteAccess: electronApi.remoteAccess,
    getArtifactPreviewEnvironment: () => electronApi.getArtifactPreviewEnvironment(),
    client,
    subscribeWorkspaceSessionUpdates: async (listener) =>
      electronApi.subscribe(
        "openducktor://workspace-session-updated",
        (payload: HostEventPayload<"openducktor://workspace-session-updated">) =>
          logListenerFailure(listener(payload)),
      ),
    subscribeRuntimeChanges: async (listener) =>
      electronApi.subscribe(
        RUNTIME_CHANGED_EVENT_CHANNEL,
        (payload: HostEventPayload<typeof RUNTIME_CHANGED_EVENT_CHANNEL>) =>
          logListenerFailure(listener(payload)),
      ),
    subscribeTaskMergeStatusUpdates: async (listener) =>
      electronApi.subscribe(
        TASK_MERGE_STATUS_EVENT_CHANNEL,
        (payload: HostEventPayload<typeof TASK_MERGE_STATUS_EVENT_CHANNEL>) =>
          logListenerFailure(listener(payload)),
      ),
    capabilities: {
      canOpenExternalUrls: true,
      canPreviewLocalAttachments: true,
    },
    notifications: {
      getCapability: () => electronApi.notifications.getCapability(),
      requestPermission: () => electronApi.notifications.requestPermission(),
      openSystemSettings: () => electronApi.notifications.openSystemSettings(),
      isAppFocused: () => electronApi.notifications.isAppFocused(),
      withExternalDeliveryOwnership: async (_occurrenceId, dispatch) => dispatch(true),
      showOsNotification: (request) => electronApi.notifications.show(request),
      publishOccurrence: async (occurrence, settings) => ({ occurrence, settings }),
      subscribeOccurrences: () => () => {},
      subscribeClicks: (listener) => electronApi.notifications.subscribeClicks(listener),
      dispose: () => {},
    },
    subscribeRunEvents: subscribeElectronEvent(electronApi, RUN_EVENT_CHANNEL),
    subscribeWorkspaceProviderSetupUpdates: async (listener) =>
      electronApi.subscribe("openducktor://workspace-provider-setup-updated", listener),
    subscribeAzureDevOpsConnectionUpdates: async (listener) =>
      electronApi.subscribe(AZURE_DEVOPS_CONNECTION_EVENT_CHANNEL, listener),
    observeAgentSessionLive: async (input, listener) => {
      const attachment = createAgentSessionLiveAttachment(input.repoPath, listener);
      const unsubscribe = electronApi.subscribe(
        AGENT_SESSION_LIVE_EVENT_CHANNEL,
        attachment.accept,
        input.repoPath,
      );
      try {
        attachment.install(await client.agentSessionLiveAttach(input));
      } catch (cause) {
        unsubscribe();
        throw cause;
      }
      return unsubscribe;
    },
    subscribeNotificationStream: (input, onFrame, onFailure) =>
      electronApi.notificationStream.subscribe(input, onFrame, onFailure),
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
    resolveLocalAttachmentPreview: async (path, signal) => {
      signal.throwIfAborted();
      const src = await electronApi.resolveLocalAttachmentPreviewSrc(path);
      signal.throwIfAborted();
      return { kind: "url", src };
    },
    resolveTaskAssetSource: async (context, signal) => {
      signal.throwIfAborted();
      return { kind: "url", src: createElectronTaskAssetUrl(context) };
    },
    editorClipboard: {
      readText(type) {
        if (type === undefined) return electronApi.editorClipboard.readText();
        if (type !== PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE) {
          throw new TypeError("Unsupported editor clipboard format.");
        }
        return electronApi.editorClipboard.readText(type);
      },
    },
    subscribeBrowserTabEvents: async (listener) =>
      electronApi.subscribe(BROWSER_EVENT_CHANNEL, listener),
    // Mount each browser tab as `<webview partition={partition(workspaceId)} src="about:blank"
    // allowpopups>`, then call `bindGuest` with its `getWebContentsId()`. The engine takes control
    // of the page first, then loads the tab URL, so the page never runs without the host.
    browser: {
      surface: "webview",
      partition: electronBrowserPartition,
      connect: (onFrame, onStateChange) =>
        connectFrameChannel(electronApi.browser, onFrame, onStateChange),
      bindGuest: (tabId, webContentsId) => electronApi.browser.bindGuest(tabId, webContentsId),
      pickFiles: (input) => electronApi.browser.pickFiles(input),
    },
    terminals: {
      connect: (onFrame, onStateChange) =>
        connectFrameChannel(electronApi.terminals, onFrame, onStateChange),
    },
  };
};
