import { createTauriHostClient, type TauriHostClient } from "@openducktor/adapters-tauri-host";
import {
  createBrowserLiveHostClient,
  subscribeBrowserLiveDevServerEvents,
  subscribeBrowserLiveRunEvents,
} from "@/lib/browser-live-client";
import { isBrowserAppMode } from "@/lib/browser-mode";
import { isTauriRuntime } from "@/lib/runtime";

export type RunEventListener = (payload: unknown) => void;
export type HostBridge = {
  client: TauriHostClient;
  subscribeRunEvents: (listener: RunEventListener) => Promise<() => void>;
  subscribeDevServerEvents: (listener: RunEventListener) => Promise<() => void>;
};

const RUN_EVENT_SUBSCRIPTIONS_UNAVAILABLE_ERROR =
  "Run-event subscriptions require the desktop shell or browser live mode.";
const DEV_SERVER_EVENT_SUBSCRIPTIONS_UNAVAILABLE_ERROR =
  "Dev-server event subscriptions require the desktop shell or browser live mode.";

let tauriCoreModulePromise: Promise<typeof import("@tauri-apps/api/core")> | null = null;

const getTauriCoreModule = (): Promise<typeof import("@tauri-apps/api/core")> => {
  if (!tauriCoreModulePromise) {
    tauriCoreModulePromise = import("@tauri-apps/api/core");
  }
  return tauriCoreModulePromise;
};

const notAvailable = async <T>(): Promise<T> => {
  throw new Error("Tauri runtime not available. Run inside the desktop shell.");
};

const createHostCommands = (): TauriHostClient => {
  if (!isTauriRuntime()) {
    if (isBrowserAppMode()) {
      return createBrowserLiveHostClient();
    }
    return createTauriHostClient(notAvailable);
  }

  return createTauriHostClient(async <T>(command: string, args?: Record<string, unknown>) => {
    const api = await getTauriCoreModule();
    return api.invoke<T>(command, args);
  });
};

const createRunEventSubscription = (): HostBridge["subscribeRunEvents"] => async (listener) => {
  if (isBrowserAppMode()) {
    return subscribeBrowserLiveRunEvents(listener);
  }

  if (!isTauriRuntime()) {
    throw new Error(RUN_EVENT_SUBSCRIPTIONS_UNAVAILABLE_ERROR);
  }

  const events = await import("@tauri-apps/api/event");
  return events.listen("openducktor://run-event", (event) => {
    listener(event.payload);
  });
};

const createDevServerEventSubscription =
  (): HostBridge["subscribeDevServerEvents"] => async (listener) => {
    if (isBrowserAppMode()) {
      return subscribeBrowserLiveDevServerEvents(listener);
    }

    if (!isTauriRuntime()) {
      throw new Error(DEV_SERVER_EVENT_SUBSCRIPTIONS_UNAVAILABLE_ERROR);
    }

    const events = await import("@tauri-apps/api/event");
    return events.listen("openducktor://dev-server-event", (event) => {
      listener(event.payload);
    });
  };

export const createHostBridge = (): HostBridge => ({
  client: createHostCommands(),
  subscribeRunEvents: createRunEventSubscription(),
  subscribeDevServerEvents: createDevServerEventSubscription(),
});

export const hostBridge = createHostBridge();

export const createHostClient = (): TauriHostClient => createHostCommands();

export const hostClient = hostBridge.client;

export const subscribeRunEvents = hostBridge.subscribeRunEvents;
export const subscribeDevServerEvents = hostBridge.subscribeDevServerEvents;
