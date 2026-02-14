const isTauriRuntime = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

export const pickRepositoryDirectory = async (): Promise<string | null> => {
  if (!isTauriRuntime()) {
    throw new Error("Directory picker is only available in the desktop app.");
  }

  const dialog = await import("@tauri-apps/plugin-dialog");
  const selected = await dialog.open({
    directory: true,
    multiple: false,
    title: "Select Repository",
  });

  if (!selected) {
    return null;
  }

  if (Array.isArray(selected)) {
    return selected[0] ?? null;
  }

  return selected;
};
