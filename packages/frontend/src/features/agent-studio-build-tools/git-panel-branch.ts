import type { GitCurrentBranch } from "@openducktor/contracts";

export const resolveAgentStudioGitPanelBranch = ({
  contextMode,
  workspaceActiveBranch,
  diffBranch,
}: {
  contextMode: "repository" | "worktree";
  workspaceActiveBranch: GitCurrentBranch | null;
  diffBranch: string | null;
}): string | null => {
  if (contextMode === "worktree") {
    return diffBranch;
  }

  if (workspaceActiveBranch?.detached) {
    return null;
  }

  if (workspaceActiveBranch?.name !== undefined) {
    return workspaceActiveBranch.name ?? null;
  }

  return diffBranch;
};

export const buildAgentStudioGitPanelBranchIdentityKey = (
  workspaceActiveBranch: GitCurrentBranch | null,
): string => {
  if (workspaceActiveBranch == null) {
    return "unknown";
  }

  if (workspaceActiveBranch.detached) {
    return `detached:${workspaceActiveBranch.revision ?? "unknown"}`;
  }

  return `branch:${workspaceActiveBranch.name ?? ""}`;
};
