import { z } from "zod";
import { create } from "zustand";

export type FileListViewMode = "tree" | "list";

export const FILE_LIST_VIEW_MODE_STORAGE_KEY = "openducktor:git-panel:file-list-view:v1";
const DEFAULT_FILE_LIST_VIEW_MODE: FileListViewMode = "tree";
const fileListViewModeSchema = z.enum(["tree", "list"]);

export function readFileListViewMode(): FileListViewMode {
  try {
    const saved = globalThis.localStorage.getItem(FILE_LIST_VIEW_MODE_STORAGE_KEY);
    if (saved === null) {
      return DEFAULT_FILE_LIST_VIEW_MODE;
    }
    const parsed = fileListViewModeSchema.safeParse(saved);
    if (!parsed.success) {
      throw new Error("The saved git panel file list view is invalid.");
    }
    return parsed.data;
  } catch (error) {
    console.error("[git-panel] Failed to read the file list view.", { error });
    return DEFAULT_FILE_LIST_VIEW_MODE;
  }
}

type FileListViewModeStore = {
  viewMode: FileListViewMode;
  setViewMode: (viewMode: FileListViewMode) => void;
};

/** One device preference for every git panel in the renderer. */
export const useFileListViewModeStore = create<FileListViewModeStore>()((set, get) => ({
  viewMode: readFileListViewMode(),
  setViewMode: (viewMode) => {
    if (get().viewMode === viewMode) {
      return;
    }
    set({ viewMode });
    try {
      globalThis.localStorage.setItem(FILE_LIST_VIEW_MODE_STORAGE_KEY, viewMode);
    } catch (error) {
      console.error("[git-panel] Failed to save the file list view.", { viewMode, error });
    }
  },
}));
