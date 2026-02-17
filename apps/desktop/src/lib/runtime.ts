const TAURI_INTERNALS_FLAG = "__TAURI_INTERNALS__";

export const isTauriRuntime = (): boolean => {
  return typeof window !== "undefined" && TAURI_INTERNALS_FLAG in window;
};

export const assertTauriRuntime = (feature: string): void => {
  if (isTauriRuntime()) {
    return;
  }

  throw new Error(`${feature} is only available in the desktop app.`);
};
