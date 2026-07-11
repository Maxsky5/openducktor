import type { AppUpdateCommandResult, AppUpdateState } from "@openducktor/contracts";
import { createHostClient, type HostClient } from "@openducktor/host-client";

export type HostEventListener = (payload: unknown) => void;

export type DevServerEventSubscription = {
  transportEpoch: string;
  unsubscribe: () => void;
};

export type HostBridge = {
  client: HostClient;
  subscribeRunEvents: (listener: HostEventListener) => Promise<() => void>;
  subscribeDevServerEvents: (listener: HostEventListener) => Promise<DevServerEventSubscription>;
  subscribeTaskEvents: (listener: HostEventListener) => Promise<() => void>;
  subscribeCodexAppServerEvents?: (listener: HostEventListener) => Promise<() => void>;
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

export type ShellBridge = HostBridge & {
  appUpdates: AppUpdateBridge;
  capabilities: ShellCapabilities;
  openExternalUrl: (url: string) => Promise<void>;
  resolveLocalAttachmentPreviewSrc: (path: string) => Promise<string>;
};

const DEFAULT_UNAVAILABLE_MESSAGE =
  "OpenDucktor shell bridge is not configured. Start through the desktop shell or @openducktor/web.";

const unavailable = async <T>(): Promise<T> => {
  throw new Error(DEFAULT_UNAVAILABLE_MESSAGE);
};

const failUnavailable = async (): Promise<never> => {
  throw new Error(DEFAULT_UNAVAILABLE_MESSAGE);
};

export const createDisabledAppUpdateBridge = (reason: string): AppUpdateBridge => {
  const state: AppUpdateState = {
    status: "disabled",
    currentVersion: "unknown",
    disabledCode: "not_packaged",
    disabledReason: reason,
  };
  const disabledResult = async (): Promise<AppUpdateCommandResult> => ({
    accepted: false,
    rejection: {
      code: "not_packaged",
      message: reason,
      operation: "check",
    },
    state,
  });

  return {
    check: disabledResult,
    download: async () => ({
      accepted: false,
      rejection: {
        code: "not_packaged",
        message: reason,
        operation: "download",
      },
      state,
    }),
    getState: async () => state,
    install: async () => ({
      accepted: false,
      rejection: {
        code: "not_packaged",
        message: reason,
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
  subscribeTaskEvents: failUnavailable,
  subscribeCodexAppServerEvents: failUnavailable,
  appUpdates: createDisabledAppUpdateBridge(
    "Updates are available only in the packaged OpenDucktor desktop app.",
  ),
  capabilities: {
    canOpenExternalUrls: false,
    canPreviewLocalAttachments: false,
  },
  openExternalUrl: failUnavailable,
  resolveLocalAttachmentPreviewSrc: failUnavailable,
});

let configuredShellBridge: ShellBridge = createUnavailableShellBridge();

export const configureShellBridge = (bridge: ShellBridge): void => {
  configuredShellBridge = bridge;
};

export const getShellBridge = (): ShellBridge => configuredShellBridge;
