import type { GitTargetBranch, WorkspaceSession } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import { errorMessage } from "@/lib/errors";
import { useWorkspaceBranchState } from "@/state/app-state-provider";
import { workspaceSessionWorkingDirectory } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import { refreshWorkspaceFileQueries } from "@/state/queries/filesystem";
import { invalidateGitWorkingDirectoryQueries } from "@/state/queries/git";
import { repoConfigQueryOptions } from "@/state/queries/workspace";
import { useWorkspaceComparisonChoice } from "@/state/workspace-comparison-choices";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useWorkspaceSessionBranch } from "./use-workspace-session-branch";

/** Keep comparison choices and refreshes tied to the selected session directory. */
export function useWorkspaceSessionGit({
  workspace,
  record,
  isPanelOpen,
}: {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  isPanelOpen: boolean;
}) {
  const { activeBranch, isSwitchingBranch } = useWorkspaceBranchState();
  const repoConfig = useQuery(repoConfigQueryOptions(workspace.workspaceId));
  const queryClient = useQueryClient();
  const workingDirectory = workspaceSessionWorkingDirectory(workspace, record);
  const isWorktree = record.executionTarget.kind === "local_worktree";
  const branch = useWorkspaceSessionBranch({
    repoPath: workspace.repoPath,
    workingDirectory,
    isWorktree,
    isSwitchingBranch,
    activeBranch,
  });
  const { refreshBranch } = branch;
  const refreshRef = useRef<((scope: "git" | "all") => Promise<void>) | null>(null);
  const choice = useWorkspaceComparisonChoice({
    workspaceId: workspace.workspaceId,
    sessionId: record.id,
  });
  const target: GitTargetBranch | null = useMemo(
    () =>
      choice.target ??
      (record.executionTarget.kind === "local_repo_root"
        ? { branch: "@{upstream}" }
        : (repoConfig.data?.defaultTargetBranch ?? null)),
    [choice.target, record.executionTarget.kind, repoConfig.data?.defaultTargetBranch],
  );
  const targetError =
    !choice.target && record.executionTarget.kind === "local_worktree" && repoConfig.isError
      ? `Could not read the default target branch: ${errorMessage(repoConfig.error)}`
      : null;
  const refreshAfterChange = useCallback(
    (scope: "git" | "all") => {
      if (isWorktree || scope === "all") refreshBranch();
      const refresh = isPanelOpen ? refreshRef.current : null;
      if (workingDirectory && (scope === "git" || !refresh)) {
        void invalidateGitWorkingDirectoryQueries(
          queryClient,
          workspace.repoPath,
          workingDirectory,
        );
      }
      if (workingDirectory && scope === "all" && !refresh) {
        // File queries render their own refresh errors.
        void refreshWorkspaceFileQueries(queryClient, workingDirectory).catch(() => {});
      }
      void refresh?.(scope);
    },
    [isWorktree, isPanelOpen, queryClient, refreshBranch, workingDirectory, workspace.repoPath],
  );
  const { refetch: refetchConfig } = repoConfig;
  const retryTarget = useCallback(async () => {
    const result = await refetchConfig();
    if (result.isError) throw result.error;
  }, [refetchConfig]);
  const branchRead = isWorktree ? branch.worktreeBranch : branch.rootBranch;
  return {
    branch,
    workingDirectory,
    isWorktree,
    hasRootBranch: branch.rootBranch.data !== undefined || activeBranch !== null,
    branchError: branchRead.isError ? errorMessage(branchRead.error) : null,
    target,
    targetError,
    applyTarget: choice.applyTarget,
    retryTarget,
    refreshAfterChange,
    refreshRef,
  };
}
