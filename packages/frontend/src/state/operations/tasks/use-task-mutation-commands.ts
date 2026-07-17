import type {
  GitTargetBranch,
  TaskCard,
  TaskCreateInput,
  TaskStatus,
  TaskUpdatePatch,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  type AgentSessionReadPort,
  removeAgentSessionListQueries,
} from "@/state/queries/agent-sessions";
import { taskWorktreeQueryKeys } from "@/state/queries/build-runtime";
import { host } from "../shared/host";
import { runTaskMutationWithChatDraftCleanup } from "./task-chat-draft-cleanup";
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

export function useTaskMutationCommands({
  activeRepoPath,
  activeWorkspaceId,
  tasks,
  runTaskMutation,
  agentSessionReadPort,
}: UseTaskMutationCommandsArgs): TaskMutationCommands {
  const queryClient = useQueryClient();

  const createTask = useCallback(
    async (input: TaskCreateInput): Promise<void> => {
      requireActiveRepo(activeRepoPath);

      const title = toNormalizedTitle(input.title);
      if (!title) {
        return;
      }

      await runTaskMutation({
        refreshStrategy: { kind: "repo" },
        run: async (repoPath) => {
          await host.taskCreate(repoPath, { ...input, title });
        },
        successTitle: "Task created",
        successDescription: title,
        failureTitle: "Failed to create task",
      });
    },
    [activeRepoPath, runTaskMutation],
  );

  const updateTask = useCallback(
    async (taskId: string, patch: TaskUpdatePatch): Promise<void> => {
      await runTaskMutation({
        refreshStrategy: { kind: "task", taskId },
        run: async (repoPath) => {
          await host.taskUpdate(repoPath, taskId, patch);
        },
        successTitle: "Task updated",
        successDescription: toUpdateSuccessDescription(taskId, patch),
        failureTitle: "Failed to update task",
      });
    },
    [runTaskMutation],
  );

  const setTaskTargetBranch = useCallback(
    async (taskId: string, targetBranch: GitTargetBranch): Promise<void> => {
      await runTaskMutation({
        refreshStrategy: { kind: "task", taskId },
        run: async (repoPath) => {
          await host.taskUpdate(repoPath, taskId, { targetBranch });
        },
        successDescription: taskId,
        failureTitle: "Failed to update task target branch",
      });
    },
    [runTaskMutation],
  );

  const deleteTask = useCallback(
    async (taskId: string, deleteSubtasks = false): Promise<void> => {
      const taskIdsToRemove = collectTaskDeletionIds(tasks, taskId, deleteSubtasks);
      await runTaskMutation({
        refreshStrategy: { kind: "remove-task", taskIds: taskIdsToRemove },
        run: async (repoPath) => {
          await runTaskMutationWithChatDraftCleanup({
            queryClient,
            repoPath,
            workspaceId: activeWorkspaceId,
            taskIds: taskIdsToRemove,
            agentSessionReadPort,
            mutation: async () => {
              await host.taskDelete(repoPath, taskId, deleteSubtasks);
              await Promise.all(
                taskIdsToRemove.map((deletedTaskId) =>
                  queryClient.invalidateQueries({
                    queryKey: taskWorktreeQueryKeys.taskWorktree({
                      repoPath,
                      taskId: deletedTaskId,
                    }),
                  }),
                ),
              );
            },
          });
          await removeAgentSessionListQueries(queryClient, repoPath, taskIdsToRemove);
        },
        successTitle: "Task deleted",
        successDescription: taskId,
        failureTitle: "Failed to delete task",
      });
    },
    [activeWorkspaceId, agentSessionReadPort, queryClient, runTaskMutation, tasks],
  );

  const closeTask = useCallback(
    async (taskId: string): Promise<void> => {
      await runTaskMutation({
        refreshStrategy: { kind: "task", taskId },
        run: async (repoPath) => {
          await runTaskMutationWithChatDraftCleanup({
            queryClient,
            repoPath,
            workspaceId: activeWorkspaceId,
            taskIds: [taskId],
            agentSessionReadPort,
            mutation: async () => {
              await host.taskClose(repoPath, taskId);
              await queryClient.invalidateQueries({
                queryKey: taskWorktreeQueryKeys.taskWorktree({ repoPath, taskId }),
              });
            },
          });
        },
        successTitle: "Task closed",
        successDescription: taskId,
        failureTitle: "Failed to close task",
      });
    },
    [activeWorkspaceId, agentSessionReadPort, queryClient, runTaskMutation],
  );

  const transitionTask = useCallback(
    async (taskId: string, status: TaskStatus, reason?: string): Promise<void> => {
      await runTaskMutation({
        refreshStrategy: { kind: "task", taskId },
        run: async (repoPath) => {
          if (status !== "closed") {
            await host.taskTransition(repoPath, taskId, status, reason);
            return;
          }

          await runTaskMutationWithChatDraftCleanup({
            queryClient,
            repoPath,
            workspaceId: activeWorkspaceId,
            taskIds: [taskId],
            agentSessionReadPort,
            mutation: async () => {
              await host.taskTransition(repoPath, taskId, status, reason);
            },
          });
        },
        successDescription: taskId,
        failureTitle: "Failed to transition task",
      });
    },
    [activeWorkspaceId, agentSessionReadPort, queryClient, runTaskMutation],
  );

  const humanApproveTask = useCallback(
    async (taskId: string): Promise<void> => {
      await runTaskMutation({
        refreshStrategy: { kind: "task", taskId },
        run: async (repoPath) => {
          await runTaskMutationWithChatDraftCleanup({
            queryClient,
            repoPath,
            workspaceId: activeWorkspaceId,
            taskIds: [taskId],
            agentSessionReadPort,
            mutation: async () => {
              await host.humanApprove(repoPath, taskId);
            },
          });
        },
        successTitle: "Task approved",
        successDescription: taskId,
        failureTitle: "Failed to approve task",
      });
    },
    [activeWorkspaceId, agentSessionReadPort, queryClient, runTaskMutation],
  );

  const humanRequestChangesTask = useCallback(
    async (taskId: string, note?: string): Promise<void> => {
      await runTaskMutation({
        refreshStrategy: { kind: "task", taskId },
        run: async (repoPath) => {
          await host.humanRequestChanges(repoPath, taskId, note);
        },
        successTitle: "Changes requested",
        successDescription: taskId,
        failureTitle: "Failed to request changes",
      });
    },
    [runTaskMutation],
  );

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
}
