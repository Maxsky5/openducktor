import { FilePlus, FileText, FileX } from "lucide-react";
import type { DiffScope } from "@/features/agent-studio-git";

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

/** Estimated height in pixels of a file list row while no row is measured yet. */
export const FILE_LIST_ROW_HEIGHT = 40;

/**
 * Layout of the button in a file list row. Its `min-h-10` gives 40px, and the row border adds 1px.
 * Directory rows and closed file rows share it, so a known row height stays valid after a view switch.
 */
export const FILE_LIST_ROW_CLASS_NAME =
  "flex min-h-10 w-full min-w-0 cursor-pointer items-center gap-2 py-1 pr-3 text-left text-xs";

/** Left padding of a file list row: 0.75rem plus 1rem for each directory level. */
export const fileListRowIndentStyle = (depth: number) => ({
  paddingLeft: `${0.75 + depth}rem`,
});
