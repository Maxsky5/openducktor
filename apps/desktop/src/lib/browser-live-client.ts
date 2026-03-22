import { createTauriHostClient, type TauriHostClient } from "@openducktor/adapters-tauri-host";
import { getBrowserBackendUrl } from "@/lib/browser-mode";

type BrowserSseListener = (payload: unknown) => void;

type BrowserSseChannel = {
  eventSource: EventSource;
  listeners: Map<number, BrowserSseListener>;
  handleMessage: (event: MessageEvent<string>) => void;
};

const sseChannels = new Map<string, BrowserSseChannel>();
let nextSseListenerId = 0;

export const readBrowserLiveErrorMessage = async (response: Response): Promise<string> => {
  const text = await response.text().catch(() => "");
  const trimmedText = text.trim();

  if (trimmedText) {
    try {
      const payload = JSON.parse(trimmedText) as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) {
        return payload.error;
      }
    } catch {}

    return trimmedText;
  }

  return `Browser backend request failed with status ${response.status}.`;
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
      throw new Error(await readBrowserLiveErrorMessage(response));
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

const closeSseChannelIfUnused = (path: string, channel: BrowserSseChannel): void => {
  if (channel.listeners.size > 0) {
    return;
  }
  channel.eventSource.removeEventListener("message", channel.handleMessage as EventListener);
  channel.eventSource.close();
  sseChannels.delete(path);
};

const subscribeSseChannel = (path: string, listener: BrowserSseListener): (() => void) => {
  const baseUrl = getBrowserBackendUrl().replace(/\/$/, "");
  let channel = sseChannels.get(path);

  if (!channel) {
    const eventSource = new EventSource(`${baseUrl}/${path}`);
    const listeners = new Map<number, BrowserSseListener>();
    const handleMessage = (event: MessageEvent<string>): void => {
      const payload = parseSsePayload(event.data);
      for (const currentListener of listeners.values()) {
        currentListener(payload);
      }
    };

    eventSource.addEventListener("message", handleMessage as EventListener);
    channel = {
      eventSource,
      listeners,
      handleMessage,
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
