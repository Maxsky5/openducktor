import { TauriHostClient } from "@openblueprint/adapters-tauri-host";

const isTauriRuntime = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

const notAvailable = async <T>(): Promise<T> => {
  throw new Error("Tauri runtime not available. Run inside the desktop shell.");
};

export const createHostClient = (): TauriHostClient => {
  if (!isTauriRuntime()) {
    return new TauriHostClient(notAvailable);
  }

  return new TauriHostClient(async <T>(command: string, args?: Record<string, unknown>) => {
    const api = await import("@tauri-apps/api/core");
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
  return events.listen("openblueprint://run-event", (event) => {
    listener(event.payload);
  });
};
