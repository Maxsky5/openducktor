import { FilePlus, FileText, FileX, FolderGit2 } from "lucide-react";
import type { DiffScope } from "@/features/agent-studio-git";
import type { FileListViewMode } from "./file-list-view-preference";

export const FILE_STATUS_ICON = new Map<string, typeof FileText>([
  ["modified", FileText],
  ["added", FilePlus],
  ["deleted", FileX],
  ["submodule", FolderGit2],
]);

export const FILE_STATUS_COLOR = new Map<string, string>([
  ["modified", "text-blue-600 dark:text-blue-400"],
  ["added", "text-green-600 dark:text-green-400"],
  ["deleted", "text-red-600 dark:text-red-400"],
  ["submodule", "text-blue-600 dark:text-blue-400"],
]);

/** The internal views of the Git panel, in display order. */
export type GitPanelTab = DiffScope | "history";

/** A short count or state shown next to each tab label. */
/** The file count of each list tab, or null when its tab shows no count. */
export type GitPanelTabCounts = {
  uncommitted: number | null;
  target: number | null;
};

export const GIT_PANEL_TABS: Array<{ tab: GitPanelTab; label: string; testId: string }> = [
  {
    tab: "uncommitted",
    label: "Uncommitted changes",
    testId: "agent-studio-git-diff-scope-uncommitted",
  },
  {
    tab: "target",
    label: "Branch changes",
    testId: "agent-studio-git-diff-scope-target",
  },
  {
    tab: "history",
    label: "History",
    testId: "agent-studio-git-tab-history",
  },
];

export const PRELOAD_DIFF_LIMIT = 12;

export const INLINE_CODE_CLASS_NAME =
  "rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground";

/**
 * Minimum height in pixels of the button in a file list row in each view. The row border adds 1px.
 * List view rows have a directory line under the file name. Tree view rows show only the name, so they are shorter.
 * The row height cache also uses it to change known row heights at a view switch.
 */
export const FILE_LIST_ROW_HEIGHT = {
  list: 40,
  tree: 28,
} as const satisfies Record<FileListViewMode, number>;

/** Layout of the button in a file list row. `fileListRowStyle` gives its height and indent. */
export const FILE_LIST_ROW_CLASS_NAME =
  "flex w-full min-w-0 cursor-pointer items-center gap-2 py-1 pr-3 text-left text-xs";

/** Minimum height and left padding of a file list row button. The padding is 0.75rem plus 1rem for each directory level. */
export const fileListRowStyle = (viewMode: FileListViewMode, depth: number) => ({
  minHeight: `${FILE_LIST_ROW_HEIGHT[viewMode]}px`,
  paddingLeft: `${0.75 + depth}rem`,
});
