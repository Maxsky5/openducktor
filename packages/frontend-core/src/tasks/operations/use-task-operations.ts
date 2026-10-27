import { useMemo } from "react";
import { runTaskMutationWithChatDraftCleanup } from "./task-chat-draft-cleanup";
import { useTaskMutationRunner } from "./task-mutation-runner";
import type { UseTaskOperationsArgs, UseTaskOperationsResult } from "./task-operations-types";
import { useTaskMutationCommands } from "./use-task-mutation-commands";
import {
  type TaskPullRequestChatDraftCleanupPort,
  type TaskPullRequestHostPort,
  useTaskPullRequestOperations,
} from "./use-task-pull-request-operations";
import { useTaskReadFlow } from "./use-task-read-flow";
import { useTaskResetOperations } from "./use-task-reset-operations";
import { useClientConnection } from "../../connection/client-connection-react";

export function useTaskOperations({
  activeWorkspace,
  agentSessionReadPort: suppliedAgentSessionReadPort,
}: UseTaskOperationsArgs): UseTaskOperationsResult {
  const { feedback, host: hostConnection } = useClientConnection();
  const host = hostConnection.client;
  const agentSessionReadPort = suppliedAgentSessionReadPort ?? host;
  const activeRepoPath = activeWorkspace?.repoPath ?? null;
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const pullRequestHostPort = useMemo<TaskPullRequestHostPort>(
    () => ({
      detectPullRequest: host.taskPullRequestDetect,
      linkMergedPullRequest: host.taskPullRequestLinkMerged,
      unlinkPullRequest: host.taskPullRequestUnlink,
    }),
    [host],
  );
  const pullRequestChatDraftCleanup = useMemo<TaskPullRequestChatDraftCleanupPort>(
    () => ({
      runMutation: (input) =>
        runTaskMutationWithChatDraftCleanup({ ...input, agentSessionReadPort }),
    }),
    [agentSessionReadPort],
  );
  const taskReadFlow = useTaskReadFlow({ activeRepoPath });
  const { clearTaskReadState } = taskReadFlow;
  const mutationRunner = useTaskMutationRunner({ activeRepoPath });
  const mutationCommands = useTaskMutationCommands({
    activeRepoPath,
    activeWorkspaceId,
    runTaskMutation: mutationRunner.runTaskMutation,
    agentSessionReadPort,
  });
  const resetOperations = useTaskResetOperations({
    activeRepoPath,
    agentSessionReadPort,
    refreshTaskData: taskReadFlow.refreshTaskData,
  });
  const pullRequestOperations = useTaskPullRequestOperations({
    activeRepoPath,
    activeWorkspaceId,
    tasks: taskReadFlow.tasks,
    refreshTaskData: taskReadFlow.refreshTaskData,
    runTaskMutation: mutationRunner.runTaskMutation,
    pullRequestHostPort,
    feedback,
    taskChatDraftCleanup: pullRequestChatDraftCleanup,
  });

  return {
    ...pullRequestOperations,
    tasks: taskReadFlow.tasks,
    tasksAreCurrent: taskReadFlow.tasksAreCurrent,
    isForegroundLoadingTasks: taskReadFlow.isForegroundLoadingTasks,
    isRefreshingTasksInBackground: taskReadFlow.isRefreshingTasksInBackground,
    isLoadingTasks: taskReadFlow.isLoadingTasks,
    setIsLoadingTasks: taskReadFlow.setIsLoadingTasks,
    clearTaskData: clearTaskReadState,
    refreshTaskData: taskReadFlow.refreshTaskData,
    loadWorkspaceTasks: taskReadFlow.loadWorkspaceTasks,
    refreshTasksWithOptions: taskReadFlow.refreshTasksWithOptions,
    refreshTasks: taskReadFlow.refreshTasks,
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
