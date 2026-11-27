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
import type { HostClient } from "@openducktor/host-client";
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
    await runTaskMutation({
      background: {
        workspace: scopeFor(requireActiveRepo(activeRepoPath)),
        taskId,
        action: "Delete task",
      },
      run: async (repoPath, tracking) => {
        await taskChatDraftCleanup.runMutation({
          queryClient,
          repoPath,
          workspaceId: activeWorkspaceId,
          taskIds: [taskId],
          mutation: async () => {
            try {
              await hostPort.taskDelete(
                scopeFor(repoPath),
                taskId,
                ...(tracking ? ([tracking] as const) : []),
              );
            } finally {
              await invalidateTaskStopImpact(queryClient, scopeFor(repoPath));
            }
          },
        });
      },
      successTitle: "Task deleted",
      successDescription: taskId,
      failureTitle: "Failed to delete task",
    });
    const repoPath = requireActiveRepo(activeRepoPath);
    await Promise.all([
      invalidateRepoIssueItemsQueries(queryClient, scopeFor(repoPath)),
      removeAgentSessionListQueries(queryClient, scopeFor(repoPath), [taskId]),
    ]);
  };

  const closeTask = async (
    taskId: string,
    { removeWorktree }: CloseTaskOptions,
  ): Promise<TaskCard> =>
    runTaskMutation({
      background: {
        workspace: scopeFor(requireActiveRepo(activeRepoPath)),
        taskId,
        action: "Close task",
      },
      run: (repoPath, tracking) =>
        taskChatDraftCleanup.runMutation({
          queryClient,
          repoPath,
          workspaceId: activeWorkspaceId,
          taskIds: [taskId],
          mutation: async () => {
            try {
              return await hostPort.taskClose(
                scopeFor(repoPath),
                taskId,
                removeWorktree,
                ...(tracking ? ([tracking] as const) : []),
              );
            } finally {
              await invalidateTaskStopImpact(queryClient, scopeFor(repoPath));
            }
          },
        }),
      successTitle: "Task closed",
      successDescription: worktreeCleanupDescription(taskId, removeWorktree),
      failureTitle: "Failed to close task",
    });

  const removeTaskWorktree = async (taskId: string): Promise<void> => {
    const workspace = scopeFor(requireActiveRepo(activeRepoPath));
    await runTaskMutation({
      background: {
        workspace,
        taskId,
        action: "Remove worktree",
      },
      run: (_repoPath, tracking) => hostPort.taskWorktreeRemove(workspace, taskId, tracking),
      successTitle: "Worktree removed",
      successDescription: worktreeCleanupDescription(taskId, true),
      failureTitle: "Failed to remove worktree",
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

const worktreeCleanupDescription = (taskId: string, removed: boolean): string =>
  removed
    ? `${taskId}. Its worktree and local branch were removed.`
    : `${taskId}. Its worktree and local branch were kept.`;
