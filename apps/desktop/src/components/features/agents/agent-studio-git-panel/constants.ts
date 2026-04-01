import { FilePlus, FileText, FileX } from "lucide-react";
import type { DiffScope } from "@/features/agent-studio-git";

export const FILE_STATUS_ICON: Record<string, typeof FileText> = {
  modified: FileText,
  added: FilePlus,
  deleted: FileX,
};

export const FILE_STATUS_COLOR: Record<string, string> = {
  modified: "text-blue-400",
  added: "text-green-400",
  deleted: "text-red-400",
};

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

export const INLINE_CODE_CLASS_NAME =
  "rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground";
