import type {
  GitTargetBranch,
  TaskCard,
  TaskCreateInput,
  TaskStatus,
  TaskUpdatePatch,
} from "@openducktor/contracts";
import { useCallback } from "react";
import { host } from "../shared/host";
import { collectTaskDeletionIds } from "./task-deletion-ids";
import type { TaskMutationRunner } from "./task-mutation-runner";
import {
  requireActiveRepo,
  toNormalizedTitle,
  toUpdateSuccessDescription,
} from "./task-operations-model";

type UseTaskMutationCommandsArgs = {
  activeRepoPath: string | null;
  tasks: TaskCard[];
  runTaskMutation: TaskMutationRunner["runTaskMutation"];
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
  tasks,
  runTaskMutation,
}: UseTaskMutationCommandsArgs): TaskMutationCommands {
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
          await host.taskDelete(repoPath, taskId, deleteSubtasks);
        },
        successTitle: "Task deleted",
        successDescription: taskId,
        failureTitle: "Failed to delete task",
      });
    },
    [runTaskMutation, tasks],
  );

  const closeTask = useCallback(
    async (taskId: string): Promise<void> => {
      await runTaskMutation({
        refreshStrategy: { kind: "task", taskId },
        run: async (repoPath) => {
          await host.taskClose(repoPath, taskId);
        },
        successTitle: "Task closed",
        successDescription: taskId,
        failureTitle: "Failed to close task",
      });
    },
    [runTaskMutation],
  );

  const transitionTask = useCallback(
    async (taskId: string, status: TaskStatus, reason?: string): Promise<void> => {
      await runTaskMutation({
        refreshStrategy: { kind: "task", taskId },
        run: async (repoPath) => {
          await host.taskTransition(repoPath, taskId, status, reason);
        },
        successDescription: taskId,
        failureTitle: "Failed to transition task",
      });
    },
    [runTaskMutation],
  );

  const humanApproveTask = useCallback(
    async (taskId: string): Promise<void> => {
      await runTaskMutation({
        refreshStrategy: { kind: "task", taskId },
        run: async (repoPath) => {
          await host.humanApprove(repoPath, taskId);
        },
        successTitle: "Task approved",
        successDescription: taskId,
        failureTitle: "Failed to approve task",
      });
    },
    [runTaskMutation],
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
