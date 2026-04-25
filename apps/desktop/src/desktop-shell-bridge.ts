import { createTauriHostClient } from "@openducktor/adapters-tauri-host";
import type { ShellBridge } from "@openducktor/frontend";
import { isTauriRuntime } from "@openducktor/frontend/lib/runtime";

type AsyncCleanup = (() => void | Promise<void>) | null | undefined;

const RUN_EVENT_SUBSCRIPTIONS_UNAVAILABLE_ERROR =
  "Run-event subscriptions require the desktop shell.";
const DEV_SERVER_EVENT_SUBSCRIPTIONS_UNAVAILABLE_ERROR =
  "Dev-server event subscriptions require the desktop shell.";
const TASK_EVENT_SUBSCRIPTIONS_UNAVAILABLE_ERROR =
  "Task-event subscriptions require the desktop shell.";
const TAURI_EVENT_UNSUBSCRIBE_LOG_PREFIX = "[desktop-shell-bridge] Tauri event unsubscribe failed";

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

const createHostCommands = (): ShellBridge["client"] => {
  if (!isTauriRuntime()) {
    return createTauriHostClient(notAvailable);
  }

  return createTauriHostClient(async <T>(command: string, args?: Record<string, unknown>) => {
    const api = await getTauriCoreModule();
    return api.invoke<T>(command, args);
  });
};

export const createDesktopShellBridge = (): ShellBridge => {
  const client = createHostCommands();

  return {
    client,
    capabilities: {
      canOpenExternalUrls: true,
      canPreviewLocalAttachments: true,
    },
    subscribeRunEvents: async (listener) => {
      if (!isTauriRuntime()) {
        throw new Error(RUN_EVENT_SUBSCRIPTIONS_UNAVAILABLE_ERROR);
      }

      const events = await import("@tauri-apps/api/event");
      const cleanup = await events.listen("openducktor://run-event", (event) => {
        listener(event.payload);
      });

      return createSafeCleanup(cleanup);
    },
    subscribeDevServerEvents: async (listener) => {
      if (!isTauriRuntime()) {
        throw new Error(DEV_SERVER_EVENT_SUBSCRIPTIONS_UNAVAILABLE_ERROR);
      }

      const events = await import("@tauri-apps/api/event");
      const cleanup = await events.listen("openducktor://dev-server-event", (event) => {
        listener(event.payload);
      });

      return createSafeCleanup(cleanup);
    },
    subscribeTaskEvents: async (listener) => {
      if (!isTauriRuntime()) {
        throw new Error(TASK_EVENT_SUBSCRIPTIONS_UNAVAILABLE_ERROR);
      }

      const events = await import("@tauri-apps/api/event");
      const cleanup = await events.listen("openducktor://task-event", (event) => {
        listener(event.payload);
      });

      return createSafeCleanup(cleanup);
    },
    openExternalUrl: async (url) => {
      if (!isTauriRuntime()) {
        throw new Error("Opening external URLs is only available in the desktop shell.");
      }

      const api = await getTauriCoreModule();
      await api.invoke("open_external_url", { url });
    },
    resolveLocalAttachmentPreviewSrc: async (path) => {
      if (!isTauriRuntime()) {
        throw new Error("Local attachment previews are only available in the desktop shell.");
      }

      const resolvedPath = (await client.workspaceResolveLocalAttachmentPath({ path })).path;
      const api = await getTauriCoreModule();
      return api.convertFileSrc(resolvedPath, "asset");
    },
  };
};
