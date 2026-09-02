import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveRefreshInput,
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
  TaskEventCursor,
  TaskEventStreamFrame,
  TerminalFailure,
} from "@openducktor/contracts";
import { createHostClient, type HostClient } from "@openducktor/host-client";
import type { BrowserLiveControlEvent } from "@/types";

export type RunEventListener = (payload: HostEventPayload<"openducktor://run-event">) => void;
export type DevServerEventListener = (
  payload: HostEventPayload<"openducktor://dev-server-event"> | BrowserLiveControlEvent,
) => void;

export type TaskStreamFrame = TaskEventStreamFrame;

export type TaskStreamSubscription = {
  subscriptionId: string;
  acknowledge(cursor: TaskEventCursor): Promise<void>;
  unsubscribe(): void | Promise<void>;
};

export type DevServerEventSubscription = {
  transportEpoch: string;
  unsubscribe: () => void;
};

export type HostBridge = {
  client: HostClient;
  subscribeRunEvents: (listener: RunEventListener) => Promise<() => void>;
  subscribeDevServerEvents: (
    listener: DevServerEventListener,
  ) => Promise<DevServerEventSubscription>;
  observeAgentSessionLive: (
    input: AgentSessionLiveRefreshInput,
    listener: (envelope: AgentSessionLiveEnvelope) => void,
  ) => Promise<() => void>;
  subscribeTaskStream: (
    input: { cursor: TaskEventCursor | null },
    onFrame: (frame: TaskStreamFrame) => void,
    onTerminalFailure?: (cause: unknown) => void,
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
  appUpdates: AppUpdateBridge;
  capabilities: ShellCapabilities;
  notifications: NotificationBridge;
  openExternalUrl: (url: string) => Promise<void>;
  resolveLocalAttachmentPreviewSrc: (path: string) => Promise<string>;
  resolveTaskAssetSrc: (context: TaskAssetRenderContext) => Promise<string>;
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
  client: createHostClient(unavailable),
  subscribeRunEvents: failUnavailable,
  subscribeDevServerEvents: failUnavailable,
  observeAgentSessionLive: failUnavailable,
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
    }),
    requestPermission: async () => ({
      platform: "unavailable",
      supported: false,
      permission: "not_applicable",
      canGuaranteeSilent: false,
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
  resolveLocalAttachmentPreviewSrc: failUnavailable,
  resolveTaskAssetSrc: failUnavailable,
  terminals: { connect: failUnavailable },
});

let configuredShellBridge: ShellBridge = createUnavailableShellBridge();

export const configureShellBridge = (bridge: ShellBridge): void => {
  configuredShellBridge = bridge;
};

export const getShellBridge = (): ShellBridge => configuredShellBridge;
