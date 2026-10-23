import {
  effectiveWorkspaceSessionTargetBranch,
  type GitTargetBranch,
  type RepoConfig,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useWorkspaceBranchState } from "@/state/app-state-provider";
import { workspaceSessionWorkingDirectory } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { refreshWorkspaceFileQueries } from "@openducktor/frontend-core/queries/filesystem";
import { invalidateGitWorkingDirectoryQueries } from "@openducktor/frontend-core/queries/git";
import { repoConfigQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { updateWorkspaceSessionQueries } from "@openducktor/frontend-core/queries/workspace-sessions";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import type { ActiveWorkspace } from "@/types/state-slices";
import { useWorkspaceSessionBranch } from "./use-workspace-session-branch";

/** Compare with the saved session target, and keep refreshes tied to the session directory. */
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
  const host = useHostClient();
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
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const target = effectiveWorkspaceSessionTargetBranch(
    record.executionTarget.kind,
    record.targetBranch,
    repoConfig.data?.defaultTargetBranch ?? null,
  );
  const targetError = defaultTargetError(record.targetBranch, repoConfig, target);
  const { workspaceId } = workspace;
  const sessionId = record.id;
  const applyTarget = useCallback(
    async (targetBranch: GitTargetBranch) => {
      const session = await host.workspaceSessionSetTargetBranch({
        workspaceId,
        sessionId,
        targetBranch,
      });
      updateWorkspaceSessionQueries(queryClient, workspaceId, session);
    },
    [host, queryClient, sessionId, workspaceId],
  );
  /** Refreshes Git and files after a file save or a tool change. */
  const refreshAfterChange = useCallback(() => {
    refreshBranch();
    const refresh = isPanelOpen ? refreshRef.current : null;
    if (refresh) {
      // The panel shows a failed read.
      void refresh().catch(() => {});
      return;
    }
    if (!workingDirectory) return;
    void invalidateGitWorkingDirectoryQueries(queryClient, workspace.repoPath, workingDirectory);
    // File queries render their own refresh errors.
    void refreshWorkspaceFileQueries(queryClient, workingDirectory).catch(() => {});
  }, [isPanelOpen, queryClient, refreshBranch, workingDirectory, workspace.repoPath]);
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
    savedTarget: record.targetBranch,
    targetError,
    applyTarget,
    retryTarget,
    refreshAfterChange,
    refreshRef,
  };
}

/** A chat without a saved target needs a usable repository default. */
function defaultTargetError(
  savedTarget: GitTargetBranch | null,
  repoConfig: UseQueryResult<RepoConfig>,
  target: GitTargetBranch | null,
): string | null {
  if (savedTarget) return null;
  if (repoConfig.isError)
    return `Could not read the default target branch: ${errorMessage(repoConfig.error)}`;
  if (repoConfig.isSuccess && !target)
    return "The repository default target branch is Tracked upstream, which a worktree chat cannot use. Choose a target branch.";
  return null;
}
