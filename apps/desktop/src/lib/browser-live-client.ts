import { createTauriHostClient, type TauriHostClient } from "@openducktor/adapters-tauri-host";
import { getBrowserBackendUrl } from "@/lib/browser-mode";

const toErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {}

  const text = await response.text().catch(() => "");
  if (text.trim()) {
    return text.trim();
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
      throw new Error(await toErrorMessage(response));
    }

    return (await response.json()) as T;
  };
};

export const createBrowserLiveHostClient = (): TauriHostClient => {
  return createTauriHostClient(createHttpInvoke());
};

export const subscribeBrowserLiveRunEvents = async (
  listener: (payload: unknown) => void,
): Promise<() => void> => {
  const baseUrl = getBrowserBackendUrl().replace(/\/$/, "");
  const eventSource = new EventSource(`${baseUrl}/events`);

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
