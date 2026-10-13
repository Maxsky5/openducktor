import type { ResourceData } from "@/types/resource-source";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveAttachInput,
  AppUpdateCommandResult,
  AppUpdateState,
  HostEventPayload,
  NotificationClickEvent,
  NotificationDeliveryResult,
  NotificationOccurrence,
  NotificationOsCapability,
  NotificationOsDeliveryRequest,
  NotificationSettings,
  TaskAssetRenderContext,
  NotificationCursor,
  NotificationStreamFrame,
  TaskEventCursor,
  TaskEventStreamFrame,
  TerminalFailure,
} from "@openducktor/contracts";
import { createHostClient, type HostClient } from "@openducktor/host-client";
import type { BrowserLiveControlEvent } from "@/types";

/** Reconnect handlers return the recovery that must finish before remote work unlocks. */
export type BrowserLiveControlListener = (payload: BrowserLiveControlEvent) => void | Promise<void>;

/** Observe async event failures when the transport cannot await a listener. */
export const observeShellEventResult = (result: void | Promise<void>): void => {
  void Promise.resolve(result).catch((cause: unknown) => {
    console.error("Shell event listener failed", cause);
  });
};

/** Run events, such as Autopilot outcomes. Browser control events report stream loss and reconnects. */
export type RunEventListener = (
  payload: HostEventPayload<"openducktor://run-event"> | BrowserLiveControlEvent,
) => void | Promise<void>;
export type AzureDevOpsConnectionUpdateListener = (
  payload: HostEventPayload<"openducktor://azure-devops-connection-updated">,
) => void;
export type WorkspaceProviderSetupUpdateListener = (
  payload: HostEventPayload<"openducktor://workspace-provider-setup-updated">,
) => void;
export type WorkspaceSessionUpdateListener = (
  payload: HostEventPayload<"openducktor://workspace-session-updated"> | BrowserLiveControlEvent,
) => void | Promise<void>;
/** Host runtime lifecycle changes. Browser control events report stream loss and reconnects. */
export type RuntimeChangeListener = (
  payload: HostEventPayload<"openducktor://runtime-changed"> | BrowserLiveControlEvent,
) => void | Promise<void>;

export type TaskStreamFrame = TaskEventStreamFrame;

export type TaskStreamSubscription = {
  subscriptionId: string;
  acknowledge(cursor: TaskEventCursor): Promise<void>;
  unsubscribe(): void | Promise<void>;
};

export type HostBridge = {
  subscribeWorkspaceProviderSetupUpdates: (
    listener: WorkspaceProviderSetupUpdateListener,
  ) => Promise<() => void>;
  client: HostClient;
  subscribeWorkspaceSessionUpdates: (
    listener: WorkspaceSessionUpdateListener,
  ) => Promise<() => void>;
  subscribeRuntimeChanges: (listener: RuntimeChangeListener) => Promise<() => void>;
  subscribeRunEvents: (listener: RunEventListener) => Promise<() => void>;
  subscribeAzureDevOpsConnectionUpdates: (
    listener: AzureDevOpsConnectionUpdateListener,
  ) => Promise<() => void>;
  observeAgentSessionLive: (
    input: AgentSessionLiveAttachInput,
    listener: (envelope: AgentSessionLiveEnvelope) => void,
  ) => Promise<() => void>;
  subscribeNotificationStream: (
    input: { cursor: NotificationCursor | null },
    onFrame: (frame: NotificationStreamFrame) => void,
    onFailure: (cause: unknown) => void,
  ) => Promise<() => void>;
  subscribeTaskStream: (
    input: { cursor: TaskEventCursor | null },
    onFrame: (frame: TaskStreamFrame) => void,
    onTerminalFailure?: (cause: unknown) => void,
    signal?: AbortSignal,
  ) => Promise<TaskStreamSubscription>;
};

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

export type NotificationBridge = {
  getCapability(): Promise<NotificationOsCapability>;
  requestPermission(): Promise<NotificationOsCapability>;
  openSystemSettings(): Promise<void>;
  isAppFocused(): Promise<boolean>;
  withExternalDeliveryOwnership(
    occurrenceId: string,
    dispatch: (externalDeliveryOwner: boolean) => Promise<void>,
  ): Promise<void>;
  showOsNotification(request: NotificationOsDeliveryRequest): Promise<NotificationDeliveryResult>;
  publishOccurrence(
    occurrence: NotificationOccurrence,
    settings: NotificationSettings,
  ): Promise<{ occurrence: NotificationOccurrence; settings: NotificationSettings }>;
  subscribeOccurrences(
    listener: (occurrence: NotificationOccurrence, settings: NotificationSettings) => void,
  ): () => void;
  subscribeClicks(listener: (event: NotificationClickEvent) => void): () => void;
  dispose(): void;
};

export type ShellBridge = HostBridge & {
  dispose?: () => Promise<void>;
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

export const getShellBridge = (): ShellBridge => configuredShellBridge;
