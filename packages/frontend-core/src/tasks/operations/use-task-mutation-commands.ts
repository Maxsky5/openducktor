import type {
  GitTargetBranch,
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
import { taskWorktreeQueryKeys } from "../../queries/build-runtime";
import { invalidateRepoIssueItemsQueries } from "../../queries/issue-items";
import { taskStopImpactQueryKeys } from "../../queries/task-stop-impact";
import { invalidateTaskWorktreeCleanupImpact } from "../../queries/task-worktree-cleanup-impact";
import {
  createProductionTaskChatDraftCleanup,
  type TaskChatDraftCleanup,
} from "./task-chat-draft-cleanup";
import type { TaskMutationRunner } from "./task-mutation-runner";
import {
  requireActiveRepo,
  toNormalizedTitle,
  toUpdateSuccessDescription,
} from "./task-operations-model";
import { useClientConnection } from "../../connection/client-connection-react";
import type { HostClient } from "@openducktor/host-client";
import type {
  BuiltinStateId as TaskStatus,
  BuiltinTaskCard as TaskCard,
} from "@openducktor/workflows";
import type { CloseTaskOptions } from "../../types/task-close";

type UseTaskMutationCommandsArgs = {
  activeRepoPath: string | null;
  activeWorkspaceId: string | null;
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
  deleteTask: (taskId: string) => Promise<void>;
  closeTask: (taskId: string, options: CloseTaskOptions) => Promise<void>;
  /** Removes the worktree and local branches of a closed task. */
  removeTaskWorktree: (taskId: string) => Promise<void>;
  transitionTask: (taskId: string, status: TaskStatus, reason?: string) => Promise<void>;
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
  ) => Promise<TaskCard>;
  taskDelete: (repoPath: string, taskId: string) => Promise<void>;
  taskClose: (repoPath: string, taskId: string, removeWorktree: boolean) => Promise<void>;
  taskWorktreeRemove: (repoPath: string, taskId: string) => Promise<void>;
  taskTransition: (
    repoPath: string,
    taskId: string,
    status: TaskStatus,
    reason?: string,
  ) => Promise<void>;
  humanRequestChanges: (repoPath: string, taskId: string, note?: string) => Promise<void>;
};

const createHostTaskMutationPort = (host: HostClient): TaskMutationCommandHostPort => ({
  taskCreate: async (...args) => {
    await host.taskCreate(...args);
  },
  taskUpdate: (...args) => host.taskUpdate(...args),
  taskDelete: async (...args) => {
    await host.taskDelete(...args);
  },
  taskClose: async (...args) => {
    await host.taskClose(...args);
  },
  taskWorktreeRemove: (...args) => host.taskWorktreeRemove(...args),
  taskTransition: async (...args) => {
    await host.taskTransition(...args);
  },
  humanRequestChanges: async (...args) => {
    await host.humanRequestChanges(...args);
  },
});

export type TaskMutationCommandCacheImpact = {
  removeDeletedTaskCaches: (repoPath: string, taskId: string) => Promise<void>;
  invalidateTaskStopImpact: (repoPath: string) => Promise<void>;
  invalidateTaskWorktree: (repoPath: string, taskId: string) => Promise<void>;
  invalidateTaskWorktreeCleanupImpact: (repoPath: string, taskId: string) => Promise<void>;
};

type CreateTaskMutationCommandsArgs = {
  activeRepoPath: string | null;
  activeWorkspaceId: string | null;
  runTaskMutation: TaskMutationRunner["runTaskMutation"];
  hostPort: TaskMutationCommandHostPort;
  queryClient: QueryClient;
  cacheImpact: TaskMutationCommandCacheImpact;
  taskChatDraftCleanup: Pick<TaskChatDraftCleanup, "runMutation">;
};

export const createTaskMutationCommands = ({
  activeRepoPath,
  activeWorkspaceId,
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
      run: async (repoPath) => {
        await hostPort.taskUpdate(repoPath, taskId, { targetBranch });
      },
      successDescription: taskId,
      failureTitle: "Failed to update task target branch",
    });
  };

  const deleteTask = async (taskId: string): Promise<void> => {
    await runTaskMutation({
      run: async (repoPath) => {
        await taskChatDraftCleanup.runMutation({
          queryClient,
          repoPath,
          workspaceId: activeWorkspaceId,
          taskIds: [taskId],
          mutation: async () => {
            try {
              await hostPort.taskDelete(repoPath, taskId);
            } finally {
              await cacheImpact.invalidateTaskStopImpact(repoPath);
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
      invalidateRepoIssueItemsQueries(queryClient, repoPath),
      cacheImpact.removeDeletedTaskCaches(repoPath, taskId),
      cacheImpact.invalidateTaskWorktree(repoPath, taskId),
    ]);
  };

  const closeTask = async (taskId: string, { removeWorktree }: CloseTaskOptions): Promise<void> => {
    await runTaskMutation({
      run: async (repoPath) => {
        await taskChatDraftCleanup.runMutation({
          queryClient,
          repoPath,
          workspaceId: activeWorkspaceId,
          taskIds: [taskId],
          mutation: async () => {
            try {
              await hostPort.taskClose(repoPath, taskId, removeWorktree);
            } finally {
              await cacheImpact.invalidateTaskStopImpact(repoPath);
            }
            // The cleanup impact keeps no cache, so the next confirmation reads it again.
            await cacheImpact.invalidateTaskWorktree(repoPath, taskId);
          },
        });
      },
      successTitle: "Task closed",
      successDescription: worktreeCleanupDescription(taskId, removeWorktree),
      failureTitle: "Failed to close task",
    });
  };

  const removeTaskWorktree = async (taskId: string): Promise<void> => {
    await runTaskMutation({
      run: async (repoPath) => {
        try {
          await hostPort.taskWorktreeRemove(repoPath, taskId);
        } finally {
          await Promise.all([
            cacheImpact.invalidateTaskWorktree(repoPath, taskId),
            cacheImpact.invalidateTaskWorktreeCleanupImpact(repoPath, taskId),
          ]);
        }
      },
      successTitle: "Worktree removed",
      successDescription: worktreeCleanupDescription(taskId, true),
      failureTitle: "Failed to remove worktree",
    });
  };

  const transitionTask = async (
    taskId: string,
    status: TaskStatus,
    reason?: string,
  ): Promise<void> => {
    await runTaskMutation({
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
          mutation: async () => {
            try {
              await hostPort.taskTransition(repoPath, taskId, status, reason);
            } finally {
              await cacheImpact.invalidateTaskStopImpact(repoPath);
            }
          },
        });
      },
      successDescription: taskId,
      failureTitle: "Failed to transition task",
    });
  };

  const humanRequestChangesTask = async (taskId: string, note?: string): Promise<void> => {
    await runTaskMutation({
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
    removeTaskWorktree,
    transitionTask,
    humanRequestChangesTask,
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
  const hostPort = useMemo(() => createHostTaskMutationPort(host), [host]);
  const taskChatDraftCleanup = useMemo(
    () => createProductionTaskChatDraftCleanup(agentSessionReadPort, feedback),
    [agentSessionReadPort, feedback],
  );
  const cacheImpact = useMemo<TaskMutationCommandCacheImpact>(
    () => ({
      removeDeletedTaskCaches: (repoPath, taskId) =>
        removeAgentSessionListQueries(queryClient, repoPath, [taskId]),
      invalidateTaskStopImpact: (repoPath) =>
        queryClient.invalidateQueries({ queryKey: taskStopImpactQueryKeys.repo(repoPath) }),
      invalidateTaskWorktree: (repoPath, taskId) =>
        queryClient.invalidateQueries({
          queryKey: taskWorktreeQueryKeys.taskWorktree({ repoPath, taskId }),
        }),
      invalidateTaskWorktreeCleanupImpact: (repoPath, taskId) =>
        invalidateTaskWorktreeCleanupImpact(queryClient, repoPath, taskId),
    }),
    [queryClient],
  );

  return useMemo(
    () =>
      createTaskMutationCommands({
        activeRepoPath,
        activeWorkspaceId,
        runTaskMutation,
        hostPort,
        queryClient,
        cacheImpact,
        taskChatDraftCleanup,
      }),
    [
      activeRepoPath,
      activeWorkspaceId,
      cacheImpact,
      hostPort,
      runTaskMutation,
      taskChatDraftCleanup,
      queryClient,
    ],
  );
}

const worktreeCleanupDescription = (taskId: string, removed: boolean): string =>
  removed
    ? `${taskId}. Its worktree and local branch were removed.`
    : `${taskId}. Its worktree and local branch were kept.`;
