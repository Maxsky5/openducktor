import { FilePlus, FileText, FileX } from "lucide-react";
import type { DiffScope } from "@/features/agent-studio-git";
import type { FileListViewMode } from "./file-list-view-preference";

export const FILE_STATUS_ICON = new Map<string, typeof FileText>([
  ["modified", FileText],
  ["added", FilePlus],
  ["deleted", FileX],
]);

export const FILE_STATUS_COLOR = new Map<string, string>([
  ["modified", "text-blue-400"],
  ["added", "text-green-400"],
  ["deleted", "text-red-400"],
]);

export const DIFF_SCOPE_OPTIONS: Array<{
  scope: DiffScope;
  label: string;
  testId: string;
}> = [
  {
    scope: "uncommitted",
    label: "Uncommitted changes",
    testId: "agent-studio-git-diff-scope-uncommitted",
  },
  {
    scope: "target",
    label: "Branch changes",
    testId: "agent-studio-git-diff-scope-target",
  },
];

export const PRELOAD_DIFF_LIMIT = 12;

export const INLINE_CODE_CLASS_NAME =
  "rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground";

/**
 * Height in pixels of the button in a closed file list row in each view. It matches the row height class.
 * It estimates rows before a measurement, and it gives the height difference at a view switch.
 */
export const FILE_LIST_ROW_HEIGHT = {
  list: 40,
  tree: 28,
} as const satisfies Record<FileListViewMode, number>;

const FILE_LIST_ROW_HEIGHT_CLASS_NAME = {
  list: "min-h-10",
  tree: "min-h-7",
} as const satisfies Record<FileListViewMode, string>;

/**
 * Layout of the button in a file list row. Its minimum height gives `FILE_LIST_ROW_HEIGHT`, and the row border adds 1px.
 * List view rows have a directory line under the file name. Tree view rows show only the name, so they are shorter.
 */
export const fileListRowClassName = (viewMode: FileListViewMode): string =>
  `flex ${FILE_LIST_ROW_HEIGHT_CLASS_NAME[viewMode]} w-full min-w-0 cursor-pointer items-center gap-2 py-1 pr-3 text-left text-xs`;

/** Left padding of a file list row: 0.75rem plus 1rem for each directory level. */
export const fileListRowIndentStyle = (depth: number) => ({
  paddingLeft: `${0.75 + depth}rem`,
});
