import { createTauriHostClient, type TauriHostClient } from "@openducktor/adapters-tauri-host";
import {
  createBrowserLiveHostClient,
  subscribeBrowserLiveDevServerEvents,
  subscribeBrowserLiveRunEvents,
  subscribeBrowserLiveTaskEvents,
} from "@/lib/browser-live-client";
import { isBrowserAppMode } from "@/lib/browser-mode";
import { isTauriRuntime } from "@/lib/runtime";

type HostEventListener = (payload: unknown) => void;
type AsyncCleanup = (() => void | Promise<void>) | null | undefined;
type HostBridge = {
  client: TauriHostClient;
  subscribeRunEvents: (listener: HostEventListener) => Promise<() => void>;
  subscribeDevServerEvents: (listener: HostEventListener) => Promise<() => void>;
  subscribeTaskEvents: (listener: HostEventListener) => Promise<() => void>;
};

const RUN_EVENT_SUBSCRIPTIONS_UNAVAILABLE_ERROR =
  "Run-event subscriptions require the desktop shell or browser live mode.";
const DEV_SERVER_EVENT_SUBSCRIPTIONS_UNAVAILABLE_ERROR =
  "Dev-server event subscriptions require the desktop shell or browser live mode.";
const TASK_EVENT_SUBSCRIPTIONS_UNAVAILABLE_ERROR =
  "Task-event subscriptions require the desktop shell or browser live mode.";
const TAURI_EVENT_UNSUBSCRIBE_LOG_PREFIX = "[host-client] Tauri event unsubscribe failed";

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

const createSafeCleanup = (cleanup: AsyncCleanup): (() => void) => {
  let pendingCleanup = cleanup;
  let called = false;

  return () => {
    if (called || !pendingCleanup) {
      return;
    }

    called = true;
    const currentCleanup = pendingCleanup;
    pendingCleanup = null;

    try {
      const result = currentCleanup();
      if (result && typeof result.then === "function") {
        void result.catch((error: unknown) => {
          console.warn(TAURI_EVENT_UNSUBSCRIBE_LOG_PREFIX, error);
        });
      }
    } catch (error) {
      console.warn(TAURI_EVENT_UNSUBSCRIBE_LOG_PREFIX, error);
    }
  };
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
  const cleanup = await events.listen("openducktor://run-event", (event) => {
    listener(event.payload);
  });

  return createSafeCleanup(cleanup);
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
    const cleanup = await events.listen("openducktor://dev-server-event", (event) => {
      listener(event.payload);
    });

    return createSafeCleanup(cleanup);
  };

const createTaskEventSubscription = (): HostBridge["subscribeTaskEvents"] => async (listener) => {
  if (isBrowserAppMode()) {
    return subscribeBrowserLiveTaskEvents(listener);
  }

  if (!isTauriRuntime()) {
    throw new Error(TASK_EVENT_SUBSCRIPTIONS_UNAVAILABLE_ERROR);
  }

  const events = await import("@tauri-apps/api/event");
  const cleanup = await events.listen("openducktor://task-event", (event) => {
    listener(event.payload);
  });

  return createSafeCleanup(cleanup);
};

export const createHostBridge = (): HostBridge => ({
  client: createHostCommands(),
  subscribeRunEvents: createRunEventSubscription(),
  subscribeDevServerEvents: createDevServerEventSubscription(),
  subscribeTaskEvents: createTaskEventSubscription(),
});

export const hostBridge = createHostBridge();

export const hostClient = hostBridge.client;

export const subscribeDevServerEvents = hostBridge.subscribeDevServerEvents;
export const subscribeTaskEvents = hostBridge.subscribeTaskEvents;
