import type { PullRequest, TaskCard, TaskPullRequestDetectResult } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { invalidatePullRequestReviewContextQueries } from "@openducktor/frontend-core/queries/pull-request-review";
import { workspaceListQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import type {
  PendingMergedPullRequest,
  TaskPullRequestOperations,
} from "@/types/task-pull-request";
import type { RunTaskMutationWithChatDraftCleanupInput } from "./task-chat-draft-cleanup";
import type { TaskMutationRunner } from "./task-mutation-runner";
import { requireActiveRepo } from "./task-operations-model";
import type { UseTaskOperationsResult } from "./task-operations-types";

export type TaskPullRequestHostPort = {
  detectPullRequest: (repoPath: string, taskId: string) => Promise<TaskPullRequestDetectResult>;
  linkMergedPullRequest: (
    repoPath: string,
    taskId: string,
    pullRequest: PullRequest,
  ) => Promise<TaskCard>;
  unlinkPullRequest: (repoPath: string, taskId: string) => Promise<{ ok: boolean }>;
};

export type TaskPullRequestNotificationPort = {
  success: (title: string, description: string) => void;
  warning: (title: string, description: string) => void;
  error: (title: string, description: string) => void;
};

export type TaskPullRequestChatDraftCleanupPort = {
  runMutation: <TResult>(
    input: RunTaskMutationWithChatDraftCleanupInput<TResult>,
  ) => Promise<TResult>;
};

type Args = {
  activeRepoPath: string | null;
  activeWorkspaceId: string | null;
  tasks: readonly TaskCard[];
  refreshTaskData: UseTaskOperationsResult["refreshTaskData"];
  runTaskMutation: TaskMutationRunner["runTaskMutation"];
  pullRequestHostPort: TaskPullRequestHostPort;
  notificationPort: TaskPullRequestNotificationPort;
  taskChatDraftCleanup: TaskPullRequestChatDraftCleanupPort;
};

/**
 * Finish PR requests in their own repo after workspace changes.
 * Keep a ref so guards see changes before React renders.
 */
export function useTaskPullRequestOperations({
  activeRepoPath,
  activeWorkspaceId,
  tasks,
  refreshTaskData,
  runTaskMutation,
  pullRequestHostPort,
  notificationPort,
  taskChatDraftCleanup,
}: Args): TaskPullRequestOperations {
  const queryClient = useQueryClient();
  const [operations, setOperations] = useState(() => new Map<string, Operation>());
  const operationsRef = useRef(operations);
  const activeRepoPathRef = useRef(activeRepoPath);

  const updateOperation = useCallback((task: TaskKey, operation: Operation | null): void => {
    const next = new Map(operationsRef.current);
    const key = taskKey(task);
    if (operation) {
      if (next.get(key)?.phase === "detecting" && operation.phase === "confirming") {
        // Move a new confirmation to the back so it cannot replace the one shown.
        next.delete(key);
      }
      next.set(key, operation);
    } else {
      next.delete(key);
    }
    operationsRef.current = next;
    setOperations(next);
  }, []);

  const activeOperations = useMemo(
    () => [...operations.values()].filter((operation) => operation.repoPath === activeRepoPath),
    [activeRepoPath, operations],
  );
  const detectingPullRequestTaskIds = useMemo(
    () =>
      new Set(
        activeOperations
          .filter((operation) => operation.phase === "detecting")
          .map((operation) => operation.taskId),
      ),
    [activeOperations],
  );
  const linkingMergedPullRequestTaskId =
    activeOperations.find((operation) => operation.phase === "linking")?.taskId ?? null;
  const unlinkingPullRequestTaskIds = useMemo(
    () =>
      new Set(
        activeOperations
          .filter((operation) => operation.phase === "unlinking")
          .map((operation) => operation.taskId),
      ),
    [activeOperations],
  );
  const pendingMergedOperation =
    activeOperations.find(
      (operation): operation is MergedOperation =>
        operation.phase === "confirming" || operation.phase === "linking",
    ) ?? null;
  const pendingMergedPullRequest = useMemo(
    () =>
      pendingMergedOperation
        ? {
            taskId: pendingMergedOperation.taskId,
            taskTitle: pendingMergedOperation.taskTitle,
            pullRequest: pendingMergedOperation.pullRequest,
          }
        : null,
    [pendingMergedOperation],
  );

  useLayoutEffect(() => {
    activeRepoPathRef.current = activeRepoPath;
  }, [activeRepoPath]);

  useLayoutEffect(() => {
    const queryKey = workspaceListQueryOptions().queryKey;
    const cache = queryClient.getQueryCache();
    const dropClosed = (): void => {
      const openWorkspaces = queryClient.getQueryData(queryKey);
      if (!openWorkspaces) return;
      for (const operation of operationsRef.current.values()) {
        const isOpen = openWorkspaces.some(
          (workspace) =>
            workspace.workspaceId === operation.workspaceId &&
            workspace.repoPath === operation.repoPath,
        );
        if (isOpen || operation.phase === "unlinking") continue;
        if (operation.phase === "linking") {
          if (operation.keepConfirmation)
            updateOperation(operation, { ...operation, keepConfirmation: false });
        } else {
          updateOperation(operation, null);
        }
      }
    };
    dropClosed();
    // A render observer can miss closure when Query batches close and reopen updates.
    return cache.subscribe((event) => {
      if (
        event.type === "updated" &&
        event.action.type === "success" &&
        event.query === cache.find({ queryKey, exact: true })
      )
        dropClosed();
    });
  }, [queryClient, updateOperation]);

  const syncPullRequests = useCallback(
    async (taskId: string): Promise<void> => {
      let operation: Operation | null = null;
      try {
        const repoPath = requireActiveRepo(activeRepoPath);
        operation = { repoPath, taskId, workspaceId: activeWorkspaceId, phase: "detecting" };
        if (operationsRef.current.has(taskKey(operation))) {
          return;
        }
        updateOperation(operation, operation);
        const taskTitle = tasks.find((task) => task.id === taskId)?.title ?? null;
        const result = await pullRequestHostPort.detectPullRequest(repoPath, taskId);
        if (operationsRef.current.get(taskKey(operation)) !== operation) return;
        if (result.outcome === "linked") {
          await refreshTaskData(repoPath, taskId);
          if (operationsRef.current.get(taskKey(operation)) !== operation) return;
          await invalidatePullRequestReviewContextQueries(queryClient);
          if (operationsRef.current.get(taskKey(operation)) !== operation) return;
          notificationPort.success(
            "Pull request linked",
            `PR #${result.pullRequest.number} for ${taskId} (${repoPath}).`,
          );
        } else if (result.outcome === "merged") {
          updateOperation(operation, {
            repoPath,
            taskId,
            taskTitle,
            workspaceId: activeWorkspaceId,
            pullRequest: result.pullRequest,
            phase: "confirming",
            keepConfirmation: true,
          });
          if (activeRepoPathRef.current !== repoPath) {
            notificationPort.warning(
              "Merged pull request found",
              `PR #${result.pullRequest.number} for ${taskId}. Switch to ${repoPath} to confirm linking it.`,
            );
          }
        } else {
          notificationPort.warning(
            "No pull request found",
            `No open pull request found for ${taskId} on ${result.sourceBranch} (${repoPath}).`,
          );
        }
      } catch (error) {
        if (operation && operationsRef.current.get(taskKey(operation)) !== operation) return;
        notificationPort.error(
          "Failed to detect pull request",
          `${taskId} (${activeRepoPath}): ${errorMessage(error)}`,
        );
      } finally {
        if (operation && operationsRef.current.get(taskKey(operation)) === operation) {
          updateOperation(operation, null);
        }
      }
    },
    [
      activeRepoPath,
      activeWorkspaceId,
      notificationPort,
      pullRequestHostPort,
      queryClient,
      refreshTaskData,
      tasks,
      updateOperation,
    ],
  );

  const cancelLinkMergedPullRequest = useCallback((): void => {
    if (!pendingMergedOperation || pendingMergedOperation.repoPath !== activeRepoPathRef.current) {
      return;
    }
    const current = operationsRef.current.get(taskKey(pendingMergedOperation));
    if (current?.phase === "confirming") {
      updateOperation(current, null);
    }
  }, [pendingMergedOperation, updateOperation]);

  const linkMergedPullRequest = useCallback(async (): Promise<void> => {
    if (!pendingMergedOperation || pendingMergedOperation.repoPath !== activeRepoPathRef.current) {
      notificationPort.error(
        "Merged pull request state expired",
        "Re-run pull request detection and try again.",
      );
      return;
    }

    const current = operationsRef.current.get(taskKey(pendingMergedOperation));
    if (current?.phase !== "confirming") {
      return;
    }
    const { repoPath, taskId, workspaceId, pullRequest } = current;
    const linking: MergedOperation = { ...current, phase: "linking" };
    updateOperation(linking, linking);
    let linked = false;
    try {
      await taskChatDraftCleanup.runMutation({
        queryClient,
        repoPath,
        workspaceId,
        taskIds: [taskId],
        mutation: async () => {
          await pullRequestHostPort.linkMergedPullRequest(repoPath, taskId, pullRequest);
        },
      });
      linked = true;
      await refreshTaskData(repoPath, taskId);
      await invalidatePullRequestReviewContextQueries(queryClient);
      notificationPort.success(
        "Merged pull request linked",
        `PR #${pullRequest.number} for ${taskId} (${repoPath}); task moved to Done.`,
      );
    } catch (error) {
      notificationPort.error(
        "Failed to link merged pull request",
        `${taskId} (${repoPath}): ${errorMessage(error)}`,
      );
    } finally {
      const latest = operationsRef.current.get(taskKey(linking));
      updateOperation(
        linking,
        !linked && latest?.phase === "linking" && latest.keepConfirmation ? current : null,
      );
    }
  }, [
    notificationPort,
    pendingMergedOperation,
    pullRequestHostPort,
    queryClient,
    refreshTaskData,
    taskChatDraftCleanup,
    updateOperation,
  ]);

  const unlinkPullRequest = useCallback(
    async (taskId: string): Promise<void> => {
      if (
        activeRepoPath &&
        operationsRef.current.has(taskKey({ repoPath: activeRepoPath, taskId }))
      ) {
        return;
      }
      let operation: Operation | null = null;
      try {
        await runTaskMutation({
          run: async (repoPath) => {
            operation = { repoPath, taskId, workspaceId: activeWorkspaceId, phase: "unlinking" };
            updateOperation(operation, operation);
            await pullRequestHostPort.unlinkPullRequest(repoPath, taskId);
          },
          successTitle: "Pull request unlinked",
          successDescription: taskId,
          failureTitle: "Failed to unlink pull request",
        });
        await invalidatePullRequestReviewContextQueries(queryClient);
      } catch {
        // The mutation runner reports the error.
      } finally {
        if (operation) {
          updateOperation(operation, null);
        }
      }
    },
    [
      activeRepoPath,
      activeWorkspaceId,
      pullRequestHostPort,
      queryClient,
      runTaskMutation,
      updateOperation,
    ],
  );

  return {
    detectingPullRequestTaskIds,
    linkingMergedPullRequestTaskId,
    unlinkingPullRequestTaskIds,
    pendingMergedPullRequest,
    syncPullRequests,
    linkMergedPullRequest,
    cancelLinkMergedPullRequest,
    unlinkPullRequest,
  };
}

type TaskKey = {
  repoPath: string;
  taskId: string;
};

type WorkspaceTask = TaskKey & { workspaceId: string | null };

type MergedOperation = WorkspaceTask &
  PendingMergedPullRequest & {
    phase: "confirming" | "linking";
    keepConfirmation: boolean;
  };

type Operation = (WorkspaceTask & { phase: "detecting" | "unlinking" }) | MergedOperation;

function taskKey({ repoPath, taskId }: TaskKey): string {
  return JSON.stringify([repoPath, taskId]);
}
