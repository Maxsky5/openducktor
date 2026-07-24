import type { PullRequest, TaskCard, TaskPullRequestDetectResult } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { invalidatePullRequestReviewContextQueries } from "@/state/queries/pull-request-review";
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

type UseTaskPullRequestOperationsArgs = {
  activeRepoPath: string | null;
  activeWorkspaceId: string | null;
  refreshTaskData: UseTaskOperationsResult["refreshTaskData"];
  runTaskMutation: TaskMutationRunner["runTaskMutation"];
  pullRequestHostPort: TaskPullRequestHostPort;
  notificationPort: TaskPullRequestNotificationPort;
  taskChatDraftCleanup: TaskPullRequestChatDraftCleanupPort;
};

type PendingMergedPullRequestState = {
  repoPath: string;
  taskId: string;
  pullRequest: PullRequest;
};

type TaskRepoState = {
  repoPath: string;
  taskId: string;
};

export type TaskPullRequestOperations = {
  detectingPullRequestTaskId: string | null;
  linkingMergedPullRequestTaskId: string | null;
  unlinkingPullRequestTaskId: string | null;
  pendingMergedPullRequest: { taskId: string; pullRequest: PullRequest } | null;
  syncPullRequests: (taskId: string) => Promise<void>;
  linkMergedPullRequest: () => Promise<void>;
  cancelLinkMergedPullRequest: () => void;
  unlinkPullRequest: (taskId: string) => Promise<void>;
  clearPullRequestState: () => void;
};

export function useTaskPullRequestOperations({
  activeRepoPath,
  activeWorkspaceId,
  refreshTaskData,
  runTaskMutation,
  pullRequestHostPort,
  notificationPort,
  taskChatDraftCleanup,
}: UseTaskPullRequestOperationsArgs): TaskPullRequestOperations {
  const queryClient = useQueryClient();
  const [detectingPullRequestState, setDetectingPullRequestState] = useState<TaskRepoState | null>(
    null,
  );
  const [linkingMergedPullRequestTaskId, setLinkingMergedPullRequestTaskId] = useState<
    string | null
  >(null);
  const [unlinkingPullRequestTaskId, setUnlinkingPullRequestTaskId] = useState<string | null>(null);
  const [pendingMergedPullRequestState, setPendingMergedPullRequestState] =
    useState<PendingMergedPullRequestState | null>(null);
  const activeRepoPathRef = useRef(activeRepoPath);
  const linkingMergedPullRequestTaskIdRef = useRef<string | null>(null);

  const detectingPullRequestTaskId =
    detectingPullRequestState?.repoPath === activeRepoPath
      ? detectingPullRequestState.taskId
      : null;
  const pendingMergedPullRequest = useMemo(
    () =>
      pendingMergedPullRequestState?.repoPath === activeRepoPath
        ? {
            taskId: pendingMergedPullRequestState.taskId,
            pullRequest: pendingMergedPullRequestState.pullRequest,
          }
        : null,
    [activeRepoPath, pendingMergedPullRequestState],
  );

  const clearPullRequestState = useCallback(() => {
    setDetectingPullRequestState(null);
    setLinkingMergedPullRequestTaskId(null);
    setUnlinkingPullRequestTaskId(null);
    setPendingMergedPullRequestState(null);
    linkingMergedPullRequestTaskIdRef.current = null;
  }, []);

  useEffect(() => {
    activeRepoPathRef.current = activeRepoPath;
    clearPullRequestState();
  }, [activeRepoPath, clearPullRequestState]);

  const syncPullRequests = useCallback(
    async (taskId: string): Promise<void> => {
      let repoPath: string | null = null;
      try {
        repoPath = requireActiveRepo(activeRepoPath);
        setDetectingPullRequestState({ repoPath, taskId });
        const result = await pullRequestHostPort.detectPullRequest(repoPath, taskId);
        if (activeRepoPathRef.current === repoPath) {
          if (result.outcome === "linked") {
            await refreshTaskData(repoPath, taskId);
            await invalidatePullRequestReviewContextQueries(queryClient);
            notificationPort.success("Pull request linked", `PR #${result.pullRequest.number}`);
          } else if (result.outcome === "merged") {
            setPendingMergedPullRequestState({ repoPath, taskId, pullRequest: result.pullRequest });
          } else {
            notificationPort.warning(
              "No pull request found",
              `No open GitHub pull request found for ${result.sourceBranch}.`,
            );
          }
        }
      } catch (error) {
        notificationPort.error("Failed to detect pull request", errorMessage(error));
      } finally {
        setDetectingPullRequestState((current) =>
          repoPath !== null && current?.repoPath === repoPath && current.taskId === taskId
            ? null
            : current,
        );
      }
    },
    [activeRepoPath, notificationPort, pullRequestHostPort, queryClient, refreshTaskData],
  );

  const cancelLinkMergedPullRequest = useCallback((): void => {
    if (linkingMergedPullRequestTaskIdRef.current != null) {
      return;
    }
    setPendingMergedPullRequestState(null);
  }, []);

  const linkMergedPullRequest = useCallback(async (): Promise<void> => {
    if (
      !pendingMergedPullRequestState ||
      pendingMergedPullRequestState.repoPath !== activeRepoPathRef.current
    ) {
      setPendingMergedPullRequestState(null);
      notificationPort.error(
        "Merged pull request state expired",
        "Re-run pull request detection and try again.",
      );
      return;
    }

    const { repoPath, taskId, pullRequest } = pendingMergedPullRequestState;
    linkingMergedPullRequestTaskIdRef.current = taskId;
    setLinkingMergedPullRequestTaskId(taskId);
    try {
      await taskChatDraftCleanup.runMutation({
        queryClient,
        repoPath,
        workspaceId: activeWorkspaceId,
        taskIds: [taskId],
        mutation: async () => {
          await pullRequestHostPort.linkMergedPullRequest(repoPath, taskId, pullRequest);
        },
      });
      setPendingMergedPullRequestState((current) =>
        current?.repoPath === repoPath && current.taskId === taskId ? null : current,
      );
      await refreshTaskData(repoPath, taskId);
      await invalidatePullRequestReviewContextQueries(queryClient);
      notificationPort.success(
        "Merged pull request linked",
        `PR #${pullRequest.number}; task moved to Done.`,
      );
    } catch (error) {
      notificationPort.error("Failed to link merged pull request", errorMessage(error));
    } finally {
      if (linkingMergedPullRequestTaskIdRef.current === taskId) {
        linkingMergedPullRequestTaskIdRef.current = null;
      }
      setLinkingMergedPullRequestTaskId((currentTaskId) =>
        currentTaskId === taskId ? null : currentTaskId,
      );
    }
  }, [
    activeWorkspaceId,
    notificationPort,
    pendingMergedPullRequestState,
    pullRequestHostPort,
    queryClient,
    refreshTaskData,
    taskChatDraftCleanup,
  ]);

  const unlinkPullRequest = useCallback(
    async (taskId: string): Promise<void> => {
      setUnlinkingPullRequestTaskId(taskId);
      try {
        try {
          await runTaskMutation({
            refreshStrategy: { kind: "task", taskId },
            run: async (repoPath) => {
              await pullRequestHostPort.unlinkPullRequest(repoPath, taskId);
            },
            successTitle: "Pull request unlinked",
            successDescription: taskId,
            failureTitle: "Failed to unlink pull request",
          });
          await invalidatePullRequestReviewContextQueries(queryClient);
        } catch {
          // runTaskMutation already surfaced the actionable error to the user.
        }
      } finally {
        setUnlinkingPullRequestTaskId((currentTaskId) =>
          currentTaskId === taskId ? null : currentTaskId,
        );
      }
    },
    [pullRequestHostPort, queryClient, runTaskMutation],
  );

  return {
    detectingPullRequestTaskId,
    linkingMergedPullRequestTaskId,
    unlinkingPullRequestTaskId,
    pendingMergedPullRequest,
    syncPullRequests,
    linkMergedPullRequest,
    cancelLinkMergedPullRequest,
    unlinkPullRequest,
    clearPullRequestState,
  };
}
