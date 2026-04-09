import { createTauriHostClient, type TauriHostClient } from "@openducktor/adapters-tauri-host";
import { getBrowserBackendUrl } from "@/lib/browser-mode";

type BrowserSseListener = (payload: unknown) => void;

type BrowserLiveControlEvent = {
  __openducktorBrowserLive: true;
  kind: "reconnected" | "stream-warning";
  message?: string;
};

type BrowserSseChannel = {
  eventSource: EventSource;
  listeners: Map<number, BrowserSseListener>;
  handleMessage: (event: MessageEvent<string>) => void;
  handleOpen: () => void;
  handleStreamWarning: (event: MessageEvent<string>) => void;
};

const sseChannels = new Map<string, BrowserSseChannel>();
let nextSseListenerId = 0;

const readBrowserLiveErrorPayload = async (
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
    message: `Browser backend request failed with status ${response.status}.`,
    payload: null,
  };
};

export const readBrowserLiveErrorMessage = async (response: Response): Promise<string> => {
  const { message } = await readBrowserLiveErrorPayload(response);
  return message;
};

const createHttpInvoke = () => {
  const baseUrl = getBrowserBackendUrl().replace(/\/$/, "");

  return async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const response = await fetch(`${baseUrl}/invoke/${command}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(args ?? {}),
    });

    if (!response.ok) {
      const { message, payload } = await readBrowserLiveErrorPayload(response);
      throw new Error(message, payload ? { cause: payload } : undefined);
    }

    return (await response.json()) as T;
  };
};

export const createBrowserLiveHostClient = (): TauriHostClient => {
  return createTauriHostClient(createHttpInvoke());
};

const parseSsePayload = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const browserLiveControlEvent = (
  kind: BrowserLiveControlEvent["kind"],
  message?: string,
): BrowserLiveControlEvent => ({
  __openducktorBrowserLive: true,
  kind,
  ...(message ? { message } : {}),
});

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
    const eventSource = new EventSource(`${baseUrl}/${path}`);
    const listeners = new Map<number, BrowserSseListener>();
    let hasOpened = false;
    const handleMessage = (event: MessageEvent<string>): void => {
      const payload = parseSsePayload(event.data);
      for (const currentListener of listeners.values()) {
        currentListener(payload);
      }
    };
    const handleOpen = (): void => {
      if (!hasOpened) {
        hasOpened = true;
        return;
      }
      for (const currentListener of listeners.values()) {
        currentListener(browserLiveControlEvent("reconnected"));
      }
    };
    const handleStreamWarning = (event: MessageEvent<string>): void => {
      for (const currentListener of listeners.values()) {
        currentListener(browserLiveControlEvent("stream-warning", event.data));
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

export const subscribeBrowserLiveRunEvents = async (
  listener: (payload: unknown) => void,
): Promise<() => void> => {
  return subscribeSseChannel("events", listener);
};

export const subscribeBrowserLiveDevServerEvents = async (
  listener: (payload: unknown) => void,
): Promise<() => void> => {
  return subscribeSseChannel("dev-server-events", listener);
};
