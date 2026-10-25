import {
  effectiveWorkspaceSessionTargetBranch,
  type GitCurrentBranch,
  type GitTargetBranch,
  type RepoConfig,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useCallback } from "react";
import { useHostClient } from "../../connection/client-connection-react";
import { errorMessage } from "../../lib/errors";
import type { AppVisibility } from "../../platform/app-visibility";
import { repoConfigQueryOptions } from "../../queries/workspace";
import { updateWorkspaceSessionQueries } from "../../queries/workspace-sessions";
import { workspaceSessionWorkingDirectory } from "../../sessions/agent-orchestrator/session-read-model/workspace-session-records";
import type { ActiveWorkspace } from "../../types/session-slices";
import { useWorkspaceSessionBranch } from "./use-workspace-session-branch";

/**
 * Compare with the saved session target, and keep refreshes tied to the session directory. `activeBranch` is
 * the checkout of the workspace repository root, and `isSwitchingBranch` is true while a checkout
 * of the root runs.
 */
export function useWorkspaceSessionGit({
  workspace,
  record,
  activeBranch,
  isSwitchingBranch,
  visibility,
}: {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  activeBranch: GitCurrentBranch | null;
  isSwitchingBranch: boolean;
  visibility: AppVisibility;
}) {
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
    visibility,
  });
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
