import type {
  GitTargetBranch,
  TaskCard,
  TaskCreateInput,
  TaskStatus,
  TaskUpdatePatch,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  type AgentSessionReadPort,
  removeAgentSessionListQueries,
} from "@/state/queries/agent-sessions";
import { taskWorktreeQueryKeys } from "@/state/queries/build-runtime";
import { host } from "../shared/host";
import {
  createProductionTaskChatDraftCleanup,
  type TaskChatDraftCleanup,
} from "./task-chat-draft-cleanup";
import { collectTaskDeletionIds } from "./task-deletion-ids";
import type { TaskMutationRunner } from "./task-mutation-runner";
import {
  requireActiveRepo,
  toNormalizedTitle,
  toUpdateSuccessDescription,
} from "./task-operations-model";

type UseTaskMutationCommandsArgs = {
  activeRepoPath: string | null;
  activeWorkspaceId: string | null;
  tasks: TaskCard[];
  runTaskMutation: TaskMutationRunner["runTaskMutation"];
  agentSessionReadPort: AgentSessionReadPort;
};

export type TaskMutationCommands = {
  createTask: (input: TaskCreateInput) => Promise<void>;
  updateTask: (taskId: string, patch: TaskUpdatePatch) => Promise<void>;
  setTaskTargetBranch: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  deleteTask: (taskId: string, deleteSubtasks?: boolean) => Promise<void>;
  closeTask: (taskId: string) => Promise<void>;
  transitionTask: (taskId: string, status: TaskStatus, reason?: string) => Promise<void>;
  humanApproveTask: (taskId: string) => Promise<void>;
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
};

export type TaskMutationCommandHostPort = {
  taskCreate: (repoPath: string, input: TaskCreateInput) => Promise<unknown>;
  taskUpdate: (repoPath: string, taskId: string, patch: TaskUpdatePatch) => Promise<unknown>;
  taskDelete: (repoPath: string, taskId: string, deleteSubtasks: boolean) => Promise<unknown>;
  taskClose: (repoPath: string, taskId: string) => Promise<unknown>;
  taskTransition: (
    repoPath: string,
    taskId: string,
    status: TaskStatus,
    reason?: string,
  ) => Promise<unknown>;
  humanApprove: (repoPath: string, taskId: string) => Promise<unknown>;
  humanRequestChanges: (repoPath: string, taskId: string, note?: string) => Promise<unknown>;
};

export type TaskMutationCommandCacheImpact = {
  removeDeletedTaskCaches: (repoPath: string, taskIds: string[]) => Promise<void>;
  invalidateTaskWorktree: (repoPath: string, taskId: string) => Promise<void>;
};

type CreateTaskMutationCommandsArgs = {
  activeRepoPath: string | null;
  activeWorkspaceId: string | null;
  tasks: TaskCard[];
  runTaskMutation: TaskMutationRunner["runTaskMutation"];
  hostPort: TaskMutationCommandHostPort;
  queryClient: QueryClient;
  cacheImpact: TaskMutationCommandCacheImpact;
  taskChatDraftCleanup: Pick<TaskChatDraftCleanup, "runMutation">;
};

export const createTaskMutationCommands = ({
  activeRepoPath,
  activeWorkspaceId,
  tasks,
  runTaskMutation,
  hostPort,
  queryClient,
  cacheImpact,
  taskChatDraftCleanup,
}: CreateTaskMutationCommandsArgs): TaskMutationCommands => {
  const createTask = async (input: TaskCreateInput): Promise<void> => {
    requireActiveRepo(activeRepoPath);
    const title = toNormalizedTitle(input.title);
    if (!title) return;

    await runTaskMutation({
      refreshStrategy: { kind: "repo" },
      run: async (repoPath) => {
        await hostPort.taskCreate(repoPath, { ...input, title });
      },
      successTitle: "Task created",
      successDescription: title,
      failureTitle: "Failed to create task",
    });
  };

  const updateTask = async (taskId: string, patch: TaskUpdatePatch): Promise<void> => {
    await runTaskMutation({
      refreshStrategy: { kind: "task", taskId },
      run: async (repoPath) => {
        await hostPort.taskUpdate(repoPath, taskId, patch);
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
      refreshStrategy: { kind: "task", taskId },
      run: async (repoPath) => {
        await hostPort.taskUpdate(repoPath, taskId, { targetBranch });
      },
      successDescription: taskId,
      failureTitle: "Failed to update task target branch",
    });
  };

  const deleteTask = async (taskId: string, deleteSubtasks = false): Promise<void> => {
    const taskIdsToRemove = collectTaskDeletionIds(tasks, taskId, deleteSubtasks);
    await runTaskMutation({
      refreshStrategy: { kind: "remove-task", taskIds: taskIdsToRemove },
      run: async (repoPath) => {
        await taskChatDraftCleanup.runMutation({
          queryClient,
          repoPath,
          workspaceId: activeWorkspaceId,
          taskIds: taskIdsToRemove,
          mutation: () => hostPort.taskDelete(repoPath, taskId, deleteSubtasks),
        });
      },
      successTitle: "Task deleted",
      successDescription: taskId,
      failureTitle: "Failed to delete task",
    });
    const repoPath = requireActiveRepo(activeRepoPath);
    await Promise.all([
      cacheImpact.removeDeletedTaskCaches(repoPath, taskIdsToRemove),
      ...taskIdsToRemove.map((deletedTaskId) =>
        cacheImpact.invalidateTaskWorktree(repoPath, deletedTaskId),
      ),
    ]);
  };

  const closeTask = async (taskId: string): Promise<void> => {
    await runTaskMutation({
      refreshStrategy: { kind: "task", taskId },
      run: async (repoPath) => {
        await taskChatDraftCleanup.runMutation({
          queryClient,
          repoPath,
          workspaceId: activeWorkspaceId,
          taskIds: [taskId],
          mutation: async () => {
            await hostPort.taskClose(repoPath, taskId);
            await cacheImpact.invalidateTaskWorktree(repoPath, taskId);
          },
        });
      },
      successTitle: "Task closed",
      successDescription: taskId,
      failureTitle: "Failed to close task",
    });
  };

  const transitionTask = async (
    taskId: string,
    status: TaskStatus,
    reason?: string,
  ): Promise<void> => {
    await runTaskMutation({
      refreshStrategy: { kind: "task", taskId },
      run: async (repoPath) => {
        if (status !== "closed") {
          await hostPort.taskTransition(repoPath, taskId, status, reason);
          return;
        }
        await taskChatDraftCleanup.runMutation({
          queryClient,
          repoPath,
          workspaceId: activeWorkspaceId,
          taskIds: [taskId],
          mutation: () => hostPort.taskTransition(repoPath, taskId, status, reason),
        });
      },
      successDescription: taskId,
      failureTitle: "Failed to transition task",
    });
  };

  const humanApproveTask = async (taskId: string): Promise<void> => {
    await runTaskMutation({
      refreshStrategy: { kind: "task", taskId },
      run: async (repoPath) => {
        await taskChatDraftCleanup.runMutation({
          queryClient,
          repoPath,
          workspaceId: activeWorkspaceId,
          taskIds: [taskId],
          mutation: () => hostPort.humanApprove(repoPath, taskId),
        });
      },
      successTitle: "Task approved",
      successDescription: taskId,
      failureTitle: "Failed to approve task",
    });
  };

  const humanRequestChangesTask = async (taskId: string, note?: string): Promise<void> => {
    await runTaskMutation({
      refreshStrategy: { kind: "task", taskId },
      run: async (repoPath) => {
        await hostPort.humanRequestChanges(repoPath, taskId, note);
      },
      successTitle: "Changes requested",
      successDescription: taskId,
      failureTitle: "Failed to request changes",
    });
  };

  return {
    createTask,
    updateTask,
    setTaskTargetBranch,
    deleteTask,
    closeTask,
    transitionTask,
    humanApproveTask,
    humanRequestChangesTask,
  };
};

export function useTaskMutationCommands({
  activeRepoPath,
  activeWorkspaceId,
  tasks,
  runTaskMutation,
  agentSessionReadPort,
}: UseTaskMutationCommandsArgs): TaskMutationCommands {
  const queryClient = useQueryClient();
  const taskChatDraftCleanup = useMemo(
    () => createProductionTaskChatDraftCleanup(agentSessionReadPort),
    [agentSessionReadPort],
  );
  const cacheImpact = useMemo<TaskMutationCommandCacheImpact>(
    () => ({
      removeDeletedTaskCaches: (repoPath, taskIds) =>
        removeAgentSessionListQueries(queryClient, repoPath, taskIds),
      invalidateTaskWorktree: (repoPath, taskId) =>
        queryClient.invalidateQueries({
          queryKey: taskWorktreeQueryKeys.taskWorktree({ repoPath, taskId }),
        }),
    }),
    [queryClient],
  );

  return useMemo(
    () =>
      createTaskMutationCommands({
        activeRepoPath,
        activeWorkspaceId,
        tasks,
        runTaskMutation,
        hostPort: host,
        queryClient,
        cacheImpact,
        taskChatDraftCleanup,
      }),
    [
      activeRepoPath,
      activeWorkspaceId,
      cacheImpact,
      runTaskMutation,
      taskChatDraftCleanup,
      tasks,
      queryClient,
    ],
  );
}
