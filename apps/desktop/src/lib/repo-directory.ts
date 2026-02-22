import { open as openDialog } from "@tauri-apps/plugin-dialog";
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
  assertTauriRuntime("Directory picker");

  const selected = await openTauriDirectoryPicker();
  return normalizeDirectorySelection(selected);
};
