import { createTauriHostClient, type TauriHostClient } from "@openducktor/adapters-tauri-host";
import { isTauriRuntime } from "@/lib/runtime";

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

export const createHostClient = (): TauriHostClient => {
  if (!isTauriRuntime()) {
    return createTauriHostClient(notAvailable);
  }

  return createTauriHostClient(async <T>(command: string, args?: Record<string, unknown>) => {
    const api = await getTauriCoreModule();
    return api.invoke<T>(command, args);
  });
};

export const subscribeRunEvents = async (
  listener: (payload: unknown) => void,
): Promise<() => void> => {
  if (!isTauriRuntime()) {
    return () => {};
  }

  const events = await import("@tauri-apps/api/event");
  return events.listen("openducktor://run-event", (event) => {
    listener(event.payload);
  });
};
