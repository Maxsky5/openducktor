import type {
  GitTargetBranch,
  TaskCard,
  WorkspaceRef,
  TaskAssetDescriptionMutation,
  TaskCreateInput,
  TaskUpdatePatch,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  type AgentSessionReadPort,
  removeAgentSessionListQueries,
} from "../../queries/agent-sessions";
import { invalidateRepoIssueItemsQueries } from "../../queries/issue-items";
import { taskStopImpactQueryKeys } from "../../queries/task-stop-impact";
import {
  createProductionTaskChatDraftCleanup,
  type TaskChatDraftCleanup,
} from "./task-chat-draft-cleanup";
import type { TaskMutationRunner } from "./task-mutation-runner";
import {
  requireActiveRepo,
  requireWorkspaceRef,
  toNormalizedTitle,
  toUpdateSuccessDescription,
} from "./task-operations-model";
import { useClientConnection } from "../../connection/client-connection-react";
import type { BackgroundOperationInvocation, HostClient } from "@openducktor/host-client";
import type { CloseTaskOptions } from "../../types/task-close";
import type { TaskCreateWorkspace, TaskMutationCommands } from "../../types/state-slices";

export type { TaskMutationCommands } from "../../types/state-slices";

type UseTaskMutationCommandsArgs = {
  activeRepoPath: string | null;
  activeWorkspaceId: string | null;
  runTaskMutation: TaskMutationRunner["runTaskMutation"];
  agentSessionReadPort: AgentSessionReadPort;
};

export type TaskMutationCommandHostPort = Pick<
  HostClient,
  "taskCreate" | "taskUpdate" | "taskDelete" | "taskClose" | "taskWorktreeRemove"
>;

type CreateTaskMutationCommandsArgs = {
  activeRepoPath: string | null;
  activeWorkspaceId: string | null;
  runTaskMutation: TaskMutationRunner["runTaskMutation"];
  hostPort: TaskMutationCommandHostPort;
  queryClient: QueryClient;
  taskChatDraftCleanup: Pick<TaskChatDraftCleanup, "runMutation">;
};

export const createTaskMutationCommands = ({
  activeRepoPath,
  activeWorkspaceId,
  runTaskMutation,
  hostPort,
  queryClient,
  taskChatDraftCleanup,
}: CreateTaskMutationCommandsArgs): TaskMutationCommands => {
  const scopeFor = (repoPath: string) => requireWorkspaceRef(repoPath, activeWorkspaceId);
  const createTask = async (
    { workspaceId, workspaceName, repoPath }: TaskCreateWorkspace,
    input: TaskCreateInput,
    assets?: TaskAssetDescriptionMutation,
  ): Promise<void> => {
    const title = toNormalizedTitle(input.title);
    if (!title) return;

    await runTaskMutation({
      run: async () => {
        await hostPort.taskCreate({ workspaceId, repoPath }, { ...input, title }, assets);
      },
      // A task in another workspace does not show on the board, so the message names its workspace.
      successTitle:
        workspaceId === activeWorkspaceId ? "Task created" : `Task created in ${workspaceName}`,
      successDescription: title,
      failureTitle: "Failed to create task",
    });
  };

  const updateTask = async (
    taskId: string,
    patch: TaskUpdatePatch,
    assets?: TaskAssetDescriptionMutation,
  ): Promise<void> => {
    await runTaskMutation({
      run: async (repoPath) => {
        await hostPort.taskUpdate(scopeFor(repoPath), taskId, patch, assets);
      },
      successTitle: "Task updated",
      successDescription: toUpdateSuccessDescription(taskId, patch),
      failureTitle: "Failed to update task",
    });
  };

  const setTaskTargetBranch = async (
    taskId: string,
    targetBranch: GitTargetBranch,
  ): Promise<void> => {
    await runTaskMutation({
      run: async (repoPath) => {
        await hostPort.taskUpdate(scopeFor(repoPath), taskId, { targetBranch });
      },
      successDescription: taskId,
      failureTitle: "Failed to update task target branch",
    });
  };

  const deleteTask = async (taskId: string): Promise<void> => {
    const workspace = scopeFor(requireActiveRepo(activeRepoPath));
    await runTaskMutation({
      background: {
        workspace,
        taskId,
        action: "Delete task",
      },
      run: async (tracking: BackgroundOperationInvocation) => {
        await taskChatDraftCleanup.runMutation({
          queryClient,
          repoPath: workspace.repoPath,
          workspaceId: workspace.workspaceId,
          taskIds: [taskId],
          mutation: async () => {
            try {
              await hostPort.taskDelete(workspace, taskId, tracking);
            } finally {
              await invalidateTaskStopImpact(queryClient, workspace);
            }
          },
        });
      },
    });
    await Promise.all([
      invalidateRepoIssueItemsQueries(queryClient, workspace),
      removeAgentSessionListQueries(queryClient, workspace, [taskId]),
    ]);
  };

  const closeTask = async (
    taskId: string,
    { removeWorktree }: CloseTaskOptions,
  ): Promise<TaskCard> => {
    const workspace = scopeFor(requireActiveRepo(activeRepoPath));
    return runTaskMutation({
      background: {
        workspace,
        taskId,
        action: "Close task",
      },
      run: (tracking: BackgroundOperationInvocation) =>
        taskChatDraftCleanup.runMutation({
          queryClient,
          repoPath: workspace.repoPath,
          workspaceId: workspace.workspaceId,
          taskIds: [taskId],
          mutation: async () => {
            try {
              return await hostPort.taskClose(workspace, taskId, removeWorktree, tracking);
            } finally {
              await invalidateTaskStopImpact(queryClient, workspace);
            }
          },
        }),
    });
  };

  const removeTaskWorktree = async (taskId: string): Promise<void> => {
    const workspace = scopeFor(requireActiveRepo(activeRepoPath));
    await runTaskMutation({
      background: {
        workspace,
        taskId,
        action: "Remove worktree",
      },
      run: (tracking: BackgroundOperationInvocation) =>
        hostPort.taskWorktreeRemove(workspace, taskId, tracking),
    });
  };

  return {
    createTask,
    updateTask,
    setTaskTargetBranch,
    deleteTask,
    closeTask,
    removeTaskWorktree,
  };
};

export function useTaskMutationCommands({
  activeRepoPath,
  activeWorkspaceId,
  runTaskMutation,
  agentSessionReadPort,
}: UseTaskMutationCommandsArgs): TaskMutationCommands {
  const queryClient = useQueryClient();
  const { feedback, host: hostConnection } = useClientConnection();
  const host = hostConnection.client;
  const taskChatDraftCleanup = useMemo(
    () => createProductionTaskChatDraftCleanup(agentSessionReadPort, feedback),
    [agentSessionReadPort, feedback],
  );
  return useMemo(
    () =>
      createTaskMutationCommands({
        activeRepoPath,
        activeWorkspaceId,
        runTaskMutation,
        hostPort: host,
        queryClient,
        taskChatDraftCleanup,
      }),
    [activeRepoPath, activeWorkspaceId, host, runTaskMutation, taskChatDraftCleanup, queryClient],
  );
}

const invalidateTaskStopImpact = (queryClient: QueryClient, scope: WorkspaceRef): Promise<void> =>
  queryClient.invalidateQueries({ queryKey: taskStopImpactQueryKeys.repo(scope) });
