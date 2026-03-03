import { FilePlus, FileText, FileX } from "lucide-react";
import type { DiffScope } from "@/pages/agents/use-agent-studio-diff-data";

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

export const FILE_STATUS_BADGE: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
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
    label: "Compare to target",
    testId: "agent-studio-git-diff-scope-target",
  },
];

export const PRELOAD_DIFF_LIMIT = 12;
