import { useCallback } from "react";
import { useTaskMutationRunner } from "./task-mutation-runner";
import type { UseTaskOperationsArgs, UseTaskOperationsResult } from "./task-operations-types";
import { useTaskMutationCommands } from "./use-task-mutation-commands";
import { useTaskPullRequestOperations } from "./use-task-pull-request-operations";
import { useTaskReadFlow } from "./use-task-read-flow";
import { useTaskResetOperations } from "./use-task-reset-operations";

export function useTaskOperations({
  activeWorkspace,
  refreshBeadsCheckForRepo,
}: UseTaskOperationsArgs): UseTaskOperationsResult {
  const activeRepoPath = activeWorkspace?.repoPath ?? null;
  const taskReadFlow = useTaskReadFlow({ activeRepoPath, refreshBeadsCheckForRepo });
  const mutationRunner = useTaskMutationRunner({ activeRepoPath });
  const mutationCommands = useTaskMutationCommands({
    activeRepoPath,
    tasks: taskReadFlow.tasks,
    runTaskMutation: mutationRunner.runTaskMutation,
  });
  const resetOperations = useTaskResetOperations({
    activeRepoPath,
    refreshTaskData: taskReadFlow.refreshTaskData,
  });
  const pullRequestOperations = useTaskPullRequestOperations({
    activeRepoPath,
    refreshTaskData: taskReadFlow.refreshTaskData,
    runTaskMutation: mutationRunner.runTaskMutation,
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
    resetTaskImplementation: resetOperations.resetTaskImplementation,
    resetTask: resetOperations.resetTask,
    transitionTask: mutationCommands.transitionTask,
    deferTask: mutationCommands.deferTask,
    resumeDeferredTask: mutationCommands.resumeDeferredTask,
    humanApproveTask: mutationCommands.humanApproveTask,
    humanRequestChangesTask: mutationCommands.humanRequestChangesTask,
  };
}
