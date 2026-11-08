import { themePreferenceSchema, type ThemePreference } from "@openducktor/contracts";
import type { ShellBridge } from "@openducktor/frontend";
import { createLocalHostConnection } from "@openducktor/frontend-core/connection/local-host-connection";
import type { HostClient } from "@openducktor/host-client";
import { openWebSocket } from "@openducktor/host-client/remote/socket";
import {
  type OpenDucktorElectronApi,
  type OpenDucktorElectronTerminalApi,
  PIERRE_MULTI_SELECTION_CLIPBOARD_TYPE,
} from "../shared/electron-bridge-contract";
import { createElectronTaskAssetUrl } from "../shared/electron-task-asset-url";

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

/**
 * A remote host bridge in the desktop shell. Theme changes also update the native window, and
 * artifact previews use the desktop preview protocol, because the renderer origin is `file://`.
 */
export const withElectronDesktopShell = (bridge: ShellBridge): ShellBridge => ({
  ...bridge,
  client: withElectronNativeTheme(bridge.client, (theme) => getElectronApi().setNativeTheme(theme)),
  getArtifactPreviewEnvironment: () => getElectronApi().getArtifactPreviewEnvironment(),
});

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
  // The desktop host channel. Its per-launch token reaches only OpenDucktor windows.
  const { observeRemoteAccess, ...hostConnection } = createLocalHostConnection({
    prepare: () => electronApi.hostChannelEndpoint(),
    openSocket: (url, protocols, signal, onFrame, onClose) =>
      openWebSocket((offered) => new WebSocket(url, offered), protocols, signal, onFrame, onClose),
  });

  return {
    ...hostConnection,
    remoteAccess: { ...electronApi.remoteAccess, subscribeState: observeRemoteAccess },
    getArtifactPreviewEnvironment: () => electronApi.getArtifactPreviewEnvironment(),
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
    browser: {
      surface: "electron",
      connect: (onFrame, onStateChange) =>
        connectFrameChannel(electronApi.browser, onFrame, onStateChange),
      setSurface: (input) => electronApi.browser.setSurface(input),
      focusPage: (tabId) => electronApi.browser.focusPage(tabId),
      capturePage: (tabId) => electronApi.browser.capturePage(tabId),
      pickFiles: (input) => electronApi.browser.pickFiles(input),
    },
    terminals: {
      connect: (onFrame, onStateChange) =>
        connectFrameChannel(electronApi.terminals, onFrame, onStateChange),
    },
  };
};
