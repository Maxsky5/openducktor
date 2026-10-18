import type { ResourceData } from "@/types/resource-source";
import type {
  AppUpdateCommandResult,
  AppUpdateState,
  TaskAssetRenderContext,
  TerminalFailure,
} from "@openducktor/contracts";
import { createHostClient } from "@openducktor/host-client";
import type { HostConnection } from "@openducktor/frontend-core/connection/host-connection";
import type { NotificationBridge } from "@openducktor/frontend-core/platform/notification-bridge";

export type ShellCapabilities = {
  canOpenExternalUrls: boolean;
  canPreviewLocalAttachments: boolean;
};

export type AppUpdateBridge = {
  check(input: { initiator: "settings" | "menu" }): Promise<AppUpdateCommandResult>;
  download(): Promise<AppUpdateCommandResult>;
  getState(): Promise<AppUpdateState>;
  install(): Promise<AppUpdateCommandResult>;
  subscribeState(listener: (state: AppUpdateState) => void): Promise<() => void>;
};

export type TerminalTransportState = "connected" | "disconnected";

export type TerminalTransportConnection = {
  send(frame: Uint8Array): Promise<void>;
  close(): void | Promise<void>;
};

export type TerminalBridge = {
  /** Remote shells await the selected terminal owner's finite restoration. */
  subscribeRecovery?: (recover: (signal: AbortSignal) => Promise<void>) => () => void;
  connect(
    onFrame: (frame: Uint8Array) => void,
    onStateChange: (state: TerminalTransportState) => void,
    onFailure: (failure: TerminalFailure) => void,
  ): Promise<TerminalTransportConnection>;
};

export type ShellBridge = HostConnection & {
  dispose?: () => Promise<void>;
  setActive?: (active: boolean) => void;
  remoteAccess?: import("@openducktor/contracts").RemoteAccessBridge;
  remoteConnection?: Pick<
    import("@openducktor/host-client/remote").RemoteHostClient,
    "readState" | "subscribeState" | "retry"
  >;
  appUpdates: AppUpdateBridge;
  capabilities: ShellCapabilities;
  notifications: NotificationBridge;
  openExternalUrl: (url: string) => Promise<void>;
  resolveLocalAttachmentPreview: (path: string, signal: AbortSignal) => Promise<ResourceData>;
  resolveTaskAssetSource: (
    context: TaskAssetRenderContext,
    signal: AbortSignal,
  ) => Promise<ResourceData>;
  terminals: TerminalBridge;
  editorClipboard?: {
    readText(type?: string): Promise<string> | string;
  };
};

const DEFAULT_UNAVAILABLE_MESSAGE =
  "OpenDucktor shell bridge is not configured. Start through the desktop shell or @openducktor/web.";

const unavailable = async <T>(): Promise<T> => {
  throw new Error(DEFAULT_UNAVAILABLE_MESSAGE);
};

const unavailableSync = (): never => {
  throw new Error(DEFAULT_UNAVAILABLE_MESSAGE);
};

const failUnavailable = async (): Promise<never> => {
  throw new Error(DEFAULT_UNAVAILABLE_MESSAGE);
};

type DisabledAppUpdateState = Extract<AppUpdateState, { status: "disabled" }>;

export const createDisabledAppUpdateBridge = (state: DisabledAppUpdateState): AppUpdateBridge => {
  const disabledResult = async (): Promise<AppUpdateCommandResult> => ({
    accepted: false,
    rejection: {
      code: state.disabledCode,
      message: state.disabledReason,
      operation: "check",
    },
    state,
  });

  return {
    check: disabledResult,
    download: async () => ({
      accepted: false,
      rejection: {
        code: state.disabledCode,
        message: state.disabledReason,
        operation: "download",
      },
      state,
    }),
    getState: async () => state,
    install: async () => ({
      accepted: false,
      rejection: {
        code: state.disabledCode,
        message: state.disabledReason,
        operation: "install",
      },
      state,
    }),
    subscribeState: async () => () => {},
  };
};

export const createUnavailableShellBridge = (): ShellBridge => ({
  subscribeWorkspaceProviderSetupUpdates: failUnavailable,
  client: createHostClient(unavailable),
  subscribeWorkspaceSessionUpdates: failUnavailable,
  subscribeRuntimeChanges: failUnavailable,
  subscribeRunEvents: failUnavailable,
  subscribeAzureDevOpsConnectionUpdates: failUnavailable,
  observeAgentSessionLive: failUnavailable,
  subscribeNotificationStream: failUnavailable,
  subscribeTaskStream: failUnavailable,
  appUpdates: createDisabledAppUpdateBridge({
    status: "disabled",
    currentVersion: "unknown",
    disabledCode: "updater_unavailable",
    disabledReason: "Updates are available only in the packaged OpenDucktor desktop app.",
  }),
  capabilities: {
    canOpenExternalUrls: false,
    canPreviewLocalAttachments: false,
  },
  notifications: {
    getCapability: async () => ({
      platform: "unavailable",
      supported: false,
      permission: "not_applicable",
      canGuaranteeSilent: false,
      canOpenSystemSettings: false,
    }),
    requestPermission: async () => ({
      platform: "unavailable",
      supported: false,
      permission: "not_applicable",
      canGuaranteeSilent: false,
      canOpenSystemSettings: false,
    }),
    openSystemSettings: failUnavailable,
    isAppFocused: async () => false,
    withExternalDeliveryOwnership: async (_occurrenceId, dispatch) => dispatch(false),
    showOsNotification: async () => ({
      status: "unsupported",
      message: "OS notifications are unavailable because the OpenDucktor shell is not configured.",
    }),
    publishOccurrence: unavailableSync,
    subscribeOccurrences: unavailableSync,
    subscribeClicks: unavailableSync,
    dispose: () => {},
  },
  openExternalUrl: failUnavailable,
  resolveLocalAttachmentPreview: failUnavailable,
  resolveTaskAssetSource: failUnavailable,
  terminals: { connect: failUnavailable },
});

let configuredShellBridge: ShellBridge = createUnavailableShellBridge();

export const configureShellBridge = (bridge: ShellBridge): void => {
  configuredShellBridge = bridge;
};

/** The shell parts that are not the host. Code reaches the host only through its client connection. */
export type ShellPlatform = Omit<ShellBridge, keyof HostConnection>;

export const getShellBridge = (): ShellPlatform => configuredShellBridge;
