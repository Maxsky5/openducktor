import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { isBrowserAppMode } from "@/lib/browser-mode";
import { assertTauriRuntime } from "@/lib/runtime";

const DIRECTORY_PICKER_TITLE = "Select Repository";

type DirectorySelection = string | string[] | null;

const normalizeDirectorySelection = (selection: DirectorySelection): string | null => {
  if (!selection) {
    return null;
  }

  if (Array.isArray(selection)) {
    return selection[0] ?? null;
  }

  return selection;
};

const openTauriDirectoryPicker = async (): Promise<DirectorySelection> => {
  return openDialog({
    directory: true,
    multiple: false,
    title: DIRECTORY_PICKER_TITLE,
  });
};

export const pickRepositoryDirectory = async (): Promise<string | null> => {
  if (isBrowserAppMode()) {
    if (typeof window === "undefined") {
      throw new Error("Browser mode directory picker requires a window environment.");
    }
    const value = window.prompt("Repository path");
    return value?.trim() ? value.trim() : null;
  }

  assertTauriRuntime("Directory picker");

  const selected = await openTauriDirectoryPicker();
  return normalizeDirectorySelection(selected);
};
