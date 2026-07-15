import { useCallback } from "react";
import { host } from "../shared/host";
import { useTaskMutationRunner } from "./task-mutation-runner";
import type { UseTaskOperationsArgs, UseTaskOperationsResult } from "./task-operations-types";
import { useTaskMutationCommands } from "./use-task-mutation-commands";
import { useTaskPullRequestOperations } from "./use-task-pull-request-operations";
import { useTaskReadFlow } from "./use-task-read-flow";
import { useTaskResetOperations } from "./use-task-reset-operations";

export function useTaskOperations({
  activeWorkspace,
  agentSessionReadPort = host,
}: UseTaskOperationsArgs): UseTaskOperationsResult {
  const activeRepoPath = activeWorkspace?.repoPath ?? null;
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const taskReadFlow = useTaskReadFlow({ activeRepoPath });
  const mutationRunner = useTaskMutationRunner({ activeRepoPath });
  const mutationCommands = useTaskMutationCommands({
    activeRepoPath,
    activeWorkspaceId,
    tasks: taskReadFlow.tasks,
    runTaskMutation: mutationRunner.runTaskMutation,
    agentSessionReadPort,
  });
  const resetOperations = useTaskResetOperations({
    activeRepoPath,
    refreshTaskData: taskReadFlow.refreshTaskData,
  });
  const pullRequestOperations = useTaskPullRequestOperations({
    activeRepoPath,
    activeWorkspaceId,
    refreshTaskData: taskReadFlow.refreshTaskData,
    runTaskMutation: mutationRunner.runTaskMutation,
    agentSessionReadPort,
  });

  const clearTaskData = useCallback(() => {
    taskReadFlow.clearTaskReadState();
    pullRequestOperations.clearPullRequestState();
  }, [pullRequestOperations.clearPullRequestState, taskReadFlow.clearTaskReadState]);

  return {
    tasks: taskReadFlow.tasks,
    isForegroundLoadingTasks: taskReadFlow.isForegroundLoadingTasks,
    isRefreshingTasksInBackground: taskReadFlow.isRefreshingTasksInBackground,
    isLoadingTasks: taskReadFlow.isLoadingTasks,
    detectingPullRequestTaskId: pullRequestOperations.detectingPullRequestTaskId,
    linkingMergedPullRequestTaskId: pullRequestOperations.linkingMergedPullRequestTaskId,
    unlinkingPullRequestTaskId: pullRequestOperations.unlinkingPullRequestTaskId,
    pendingMergedPullRequest: pullRequestOperations.pendingMergedPullRequest,
    setIsLoadingTasks: taskReadFlow.setIsLoadingTasks,
    clearTaskData,
    refreshTaskData: taskReadFlow.refreshTaskData,
    refreshTasksWithOptions: taskReadFlow.refreshTasksWithOptions,
    refreshTasks: taskReadFlow.refreshTasks,
    syncPullRequests: pullRequestOperations.syncPullRequests,
    linkMergedPullRequest: pullRequestOperations.linkMergedPullRequest,
    cancelLinkMergedPullRequest: pullRequestOperations.cancelLinkMergedPullRequest,
    unlinkPullRequest: pullRequestOperations.unlinkPullRequest,
    createTask: mutationCommands.createTask,
    updateTask: mutationCommands.updateTask,
    setTaskTargetBranch: mutationCommands.setTaskTargetBranch,
    deleteTask: mutationCommands.deleteTask,
    closeTask: mutationCommands.closeTask,
    resetTaskImplementation: resetOperations.resetTaskImplementation,
    resetTask: resetOperations.resetTask,
    transitionTask: mutationCommands.transitionTask,
    humanApproveTask: mutationCommands.humanApproveTask,
    humanRequestChangesTask: mutationCommands.humanRequestChangesTask,
  };
}
