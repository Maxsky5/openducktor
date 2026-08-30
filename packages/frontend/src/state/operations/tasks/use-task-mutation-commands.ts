import type {
  GitTargetBranch,
  TaskAssetDescriptionMutation,
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
  createTask: (input: TaskCreateInput, assets?: TaskAssetDescriptionMutation) => Promise<void>;
  updateTask: (
    taskId: string,
    patch: TaskUpdatePatch,
    assets?: TaskAssetDescriptionMutation,
  ) => Promise<void>;
  setTaskTargetBranch: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  deleteTask: (taskId: string, deleteSubtasks?: boolean) => Promise<void>;
  closeTask: (taskId: string) => Promise<void>;
  transitionTask: (taskId: string, status: TaskStatus, reason?: string) => Promise<void>;
  humanApproveTask: (taskId: string) => Promise<void>;
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
};

export type TaskMutationCommandHostPort = {
  taskCreate: (
    repoPath: string,
    input: TaskCreateInput,
    assets?: TaskAssetDescriptionMutation,
  ) => Promise<void>;
  taskUpdate: (
    repoPath: string,
    taskId: string,
    patch: TaskUpdatePatch,
    assets?: TaskAssetDescriptionMutation,
  ) => Promise<void>;
  taskDelete: (repoPath: string, taskId: string, deleteSubtasks: boolean) => Promise<void>;
  taskClose: (repoPath: string, taskId: string) => Promise<void>;
  taskTransition: (
    repoPath: string,
    taskId: string,
    status: TaskStatus,
    reason?: string,
  ) => Promise<void>;
  humanApprove: (repoPath: string, taskId: string) => Promise<void>;
  humanRequestChanges: (repoPath: string, taskId: string, note?: string) => Promise<void>;
};

const productionTaskMutationHostPort: TaskMutationCommandHostPort = {
  taskCreate: async (...args) => {
    await host.taskCreate(...args);
  },
  taskUpdate: async (...args) => {
    await host.taskUpdate(...args);
  },
  taskDelete: async (...args) => {
    await host.taskDelete(...args);
  },
  taskClose: async (...args) => {
    await host.taskClose(...args);
  },
  taskTransition: async (...args) => {
    await host.taskTransition(...args);
  },
  humanApprove: async (...args) => {
    await host.humanApprove(...args);
  },
  humanRequestChanges: async (...args) => {
    await host.humanRequestChanges(...args);
  },
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
  const createTask = async (
    input: TaskCreateInput,
    assets?: TaskAssetDescriptionMutation,
  ): Promise<void> => {
    requireActiveRepo(activeRepoPath);
    const title = toNormalizedTitle(input.title);
    if (!title) return;

    await runTaskMutation({
      refreshStrategy: { kind: "repo" },
      run: async (repoPath) => {
        await hostPort.taskCreate(repoPath, { ...input, title }, assets);
      },
      successTitle: "Task created",
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
      refreshStrategy: { kind: "task", taskId },
      run: async (repoPath) => {
        await hostPort.taskUpdate(repoPath, taskId, patch, assets);
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
        hostPort: productionTaskMutationHostPort,
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
