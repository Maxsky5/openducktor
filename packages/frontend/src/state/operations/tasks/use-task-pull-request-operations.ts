import type { PullRequest } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionReadPort } from "@/state/queries/agent-sessions";
import { invalidatePullRequestReviewContextQueries } from "@/state/queries/pull-request-review";
import { host } from "../shared/host";
import { runTaskMutationWithChatDraftCleanup } from "./task-chat-draft-cleanup";
import type { TaskMutationRunner } from "./task-mutation-runner";
import { requireActiveRepo } from "./task-operations-model";
import type { UseTaskOperationsResult } from "./task-operations-types";

type UseTaskPullRequestOperationsArgs = {
  activeRepoPath: string | null;
  activeWorkspaceId: string | null;
  refreshTaskData: UseTaskOperationsResult["refreshTaskData"];
  runTaskMutation: TaskMutationRunner["runTaskMutation"];
  agentSessionReadPort: AgentSessionReadPort;
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
  agentSessionReadPort,
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
        const result = await host.taskPullRequestDetect(repoPath, taskId);
        if (activeRepoPathRef.current === repoPath) {
          if (result.outcome === "linked") {
            await refreshTaskData(repoPath, taskId);
            await invalidatePullRequestReviewContextQueries(queryClient);
            toast.success("Pull request linked", {
              description: `PR #${result.pullRequest.number}`,
            });
          } else if (result.outcome === "merged") {
            setPendingMergedPullRequestState({ repoPath, taskId, pullRequest: result.pullRequest });
          } else {
            toast.warning("No pull request found", {
              description: `No open GitHub pull request found for ${result.sourceBranch}.`,
            });
          }
        }
      } catch (error) {
        toast.error("Failed to detect pull request", { description: errorMessage(error) });
      } finally {
        setDetectingPullRequestState((current) =>
          repoPath !== null && current?.repoPath === repoPath && current.taskId === taskId
            ? null
            : current,
        );
      }
    },
    [activeRepoPath, queryClient, refreshTaskData],
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
      toast.error("Merged pull request state expired", {
        description: "Re-run pull request detection and try again.",
      });
      return;
    }

    const { repoPath, taskId, pullRequest } = pendingMergedPullRequestState;
    linkingMergedPullRequestTaskIdRef.current = taskId;
    setLinkingMergedPullRequestTaskId(taskId);
    try {
      await runTaskMutationWithChatDraftCleanup({
        queryClient,
        repoPath,
        workspaceId: activeWorkspaceId,
        taskIds: [taskId],
        agentSessionReadPort,
        mutation: async () => {
          await host.taskPullRequestLinkMerged(repoPath, taskId, pullRequest);
        },
      });
      setPendingMergedPullRequestState((current) =>
        current?.repoPath === repoPath && current.taskId === taskId ? null : current,
      );
      await refreshTaskData(repoPath, taskId);
      await invalidatePullRequestReviewContextQueries(queryClient);
      toast.success("Merged pull request linked", {
        description: `PR #${pullRequest.number}; task moved to Done.`,
      });
    } catch (error) {
      toast.error("Failed to link merged pull request", { description: errorMessage(error) });
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
    agentSessionReadPort,
    pendingMergedPullRequestState,
    queryClient,
    refreshTaskData,
  ]);

  const unlinkPullRequest = useCallback(
    async (taskId: string): Promise<void> => {
      setUnlinkingPullRequestTaskId(taskId);
      try {
        try {
          await runTaskMutation({
            refreshStrategy: { kind: "task", taskId },
            run: async (repoPath) => {
              await host.taskPullRequestUnlink(repoPath, taskId);
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
    [queryClient, runTaskMutation],
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
