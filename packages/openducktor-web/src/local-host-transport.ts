import { createTauriHostClient, type TauriHostClient } from "@openducktor/adapters-tauri-host";
import {
  BROWSER_LIVE_RECONNECTED_EVENT_KIND,
  BROWSER_LIVE_STREAM_WARNING_EVENT_KIND,
} from "@openducktor/frontend/lib/browser-live/constants";
import { browserLiveControlEvent } from "@openducktor/frontend/lib/browser-live-control-events";
import { getBrowserAuthToken, getBrowserBackendUrl } from "./browser-config";

type BrowserSseListener = (payload: unknown) => void;

const CONTROL_EVENT_SSE_PATHS = new Set(["dev-server-events", "task-events"]);
const APP_TOKEN_HEADER = "x-openducktor-app-token";
const SESSION_PATH = "session";

type BrowserSseChannel = {
  eventSource: EventSource;
  listeners: Map<number, BrowserSseListener>;
  handleMessage: (event: MessageEvent<string>) => void;
  handleOpen: () => void;
  handleStreamWarning: (event: MessageEvent<string>) => void;
};

const sseChannels = new Map<string, BrowserSseChannel>();
let nextSseListenerId = 0;
let sessionPromise: Promise<void> | null = null;

const readLocalHostErrorPayload = async (
  response: Response,
): Promise<{ message: string; payload: unknown | null }> => {
  const text = await response.text().catch(() => "");
  const trimmedText = text.trim();

  if (trimmedText) {
    try {
      const payload = JSON.parse(trimmedText) as { error?: unknown; message?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) {
        return { message: payload.error, payload };
      }
      if (typeof payload.message === "string" && payload.message.trim()) {
        return { message: payload.message, payload };
      }
    } catch {}

    return { message: trimmedText, payload: null };
  }

  return {
    message: `OpenDucktor web host request failed with status ${response.status}.`,
    payload: null,
  };
};

export const readLocalHostErrorMessage = async (response: Response): Promise<string> => {
  const { message } = await readLocalHostErrorPayload(response);
  return message;
};

export const ensureLocalHostSession = (): Promise<void> => {
  if (sessionPromise) {
    return sessionPromise;
  }

  const baseUrl = getBrowserBackendUrl().replace(/\/$/, "");
  const appToken = getBrowserAuthToken();
  sessionPromise = fetch(`${baseUrl}/${SESSION_PATH}`, {
    method: "POST",
    credentials: "include",
    headers: {
      [APP_TOKEN_HEADER]: appToken,
    },
  })
    .then(async (response) => {
      if (!response.ok) {
        const { message, payload } = await readLocalHostErrorPayload(response);
        throw new Error(message, payload ? { cause: payload } : undefined);
      }
    })
    .catch((error) => {
      sessionPromise = null;
      throw error;
    });

  return sessionPromise;
};

const createHttpInvoke = () => {
  const baseUrl = getBrowserBackendUrl().replace(/\/$/, "");
  const appToken = getBrowserAuthToken();

  return async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    await ensureLocalHostSession();
    const response = await fetch(`${baseUrl}/invoke/${command}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        [APP_TOKEN_HEADER]: appToken,
      },
      body: JSON.stringify(args ?? {}),
    });

    if (!response.ok) {
      const { message, payload } = await readLocalHostErrorPayload(response);
      throw new Error(message, payload ? { cause: payload } : undefined);
    }

    return (await response.json()) as T;
  };
};

export const createLocalHostClient = (): TauriHostClient =>
  createTauriHostClient(createHttpInvoke());

const parseSsePayload = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const closeSseChannelIfUnused = (path: string, channel: BrowserSseChannel): void => {
  if (channel.listeners.size > 0) {
    return;
  }
  channel.eventSource.removeEventListener("message", channel.handleMessage as EventListener);
  channel.eventSource.removeEventListener("open", channel.handleOpen as EventListener);
  channel.eventSource.removeEventListener(
    "stream-warning",
    channel.handleStreamWarning as EventListener,
  );
  channel.eventSource.close();
  sseChannels.delete(path);
};

const subscribeSseChannel = (path: string, listener: BrowserSseListener): (() => void) => {
  const baseUrl = getBrowserBackendUrl().replace(/\/$/, "");
  let channel = sseChannels.get(path);

  if (!channel) {
    const eventSource = new EventSource(`${baseUrl}/${path}`, { withCredentials: true });
    const listeners = new Map<number, BrowserSseListener>();
    const shouldEmitControlEvents = CONTROL_EVENT_SSE_PATHS.has(path);
    let hasOpened = false;
    const handleMessage = (event: MessageEvent<string>): void => {
      const payload = parseSsePayload(event.data);
      for (const currentListener of listeners.values()) {
        currentListener(payload);
      }
    };
    const handleOpen = (): void => {
      if (!shouldEmitControlEvents) {
        return;
      }
      if (!hasOpened) {
        hasOpened = true;
        return;
      }
      for (const currentListener of listeners.values()) {
        currentListener(browserLiveControlEvent(BROWSER_LIVE_RECONNECTED_EVENT_KIND));
      }
    };
    const handleStreamWarning = (event: MessageEvent<string>): void => {
      if (!shouldEmitControlEvents) {
        return;
      }
      for (const currentListener of listeners.values()) {
        currentListener(
          browserLiveControlEvent(BROWSER_LIVE_STREAM_WARNING_EVENT_KIND, event.data),
        );
      }
    };

    eventSource.addEventListener("message", handleMessage as EventListener);
    eventSource.addEventListener("open", handleOpen as EventListener);
    eventSource.addEventListener("stream-warning", handleStreamWarning as EventListener);
    channel = {
      eventSource,
      listeners,
      handleMessage,
      handleOpen,
      handleStreamWarning,
    };
    sseChannels.set(path, channel);
  }

  const listenerId = nextSseListenerId;
  nextSseListenerId += 1;
  channel.listeners.set(listenerId, listener);

  return () => {
    const currentChannel = sseChannels.get(path);
    if (!currentChannel) {
      return;
    }
    currentChannel.listeners.delete(listenerId);
    closeSseChannelIfUnused(path, currentChannel);
  };
};

export const subscribeLocalHostRunEvents = async (
  listener: (payload: unknown) => void,
): Promise<() => void> => {
  await ensureLocalHostSession();
  return subscribeSseChannel("events", listener);
};

export const subscribeLocalHostDevServerEvents = async (
  listener: (payload: unknown) => void,
): Promise<() => void> => {
  await ensureLocalHostSession();
  return subscribeSseChannel("dev-server-events", listener);
};

export const subscribeLocalHostTaskEvents = async (
  listener: (payload: unknown) => void,
): Promise<() => void> => {
  await ensureLocalHostSession();
  return subscribeSseChannel("task-events", listener);
};

export const buildLocalAttachmentPreviewUrl = (browserBackendUrl: string, path: string): string => {
  const baseUrl = browserBackendUrl.replace(/\/$/, "");
  const query = new URLSearchParams({ path });
  return `${baseUrl}/local-attachment-preview?${query.toString()}`;
};

export const __localHostTransportTestInternals = {
  resetSession() {
    sessionPromise = null;
    for (const [path, channel] of sseChannels) {
      channel.eventSource.close();
      sseChannels.delete(path);
    }
  },
};
