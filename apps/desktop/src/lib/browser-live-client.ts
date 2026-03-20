import { createTauriHostClient, type TauriHostClient } from "@openducktor/adapters-tauri-host";
import { getBrowserBackendUrl } from "@/lib/browser-mode";

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

const subscribeSseChannel = (path: string, listener: (payload: unknown) => void): (() => void) => {
  const baseUrl = getBrowserBackendUrl().replace(/\/$/, "");
  const eventSource = new EventSource(`${baseUrl}/${path}`);

  const handleMessage = (event: MessageEvent<string>): void => {
    try {
      listener(JSON.parse(event.data));
    } catch {
      listener(event.data);
    }
  };

  eventSource.addEventListener("message", handleMessage as EventListener);

  return () => {
    eventSource.removeEventListener("message", handleMessage as EventListener);
    eventSource.close();
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
