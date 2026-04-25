import { createTauriHostClient, type TauriHostClient } from "@openducktor/adapters-tauri-host";

export type HostEventListener = (payload: unknown) => void;

export type HostBridge = {
  client: TauriHostClient;
  subscribeRunEvents: (listener: HostEventListener) => Promise<() => void>;
  subscribeDevServerEvents: (listener: HostEventListener) => Promise<() => void>;
  subscribeTaskEvents: (listener: HostEventListener) => Promise<() => void>;
};

export type ShellCapabilities = {
  canOpenExternalUrls: boolean;
  canPreviewLocalAttachments: boolean;
};

export type ShellBridge = HostBridge & {
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

export const createUnavailableShellBridge = (): ShellBridge => ({
  client: createTauriHostClient(unavailable),
  subscribeRunEvents: failUnavailable,
  subscribeDevServerEvents: failUnavailable,
  subscribeTaskEvents: failUnavailable,
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
