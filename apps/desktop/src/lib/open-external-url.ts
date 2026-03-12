import { isTauriRuntime } from "@/lib/runtime";

let tauriCoreModulePromise: Promise<typeof import("@tauri-apps/api/core")> | null = null;

const getTauriCoreModule = async (): Promise<typeof import("@tauri-apps/api/core")> => {
  if (!tauriCoreModulePromise) {
    tauriCoreModulePromise = import("@tauri-apps/api/core");
  }

  return tauriCoreModulePromise;
};

export const openExternalUrl = async (url: string): Promise<void> => {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Cannot open an empty URL.");
  }
  if (!isTauriRuntime()) {
    throw new Error("Tauri runtime not available. Run inside the desktop shell.");
  }

  const api = await getTauriCoreModule();
  await api.invoke("open_external_url", { url: trimmed });
};
