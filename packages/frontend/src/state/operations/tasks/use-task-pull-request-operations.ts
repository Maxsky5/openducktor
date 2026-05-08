import type { PullRequest } from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { host } from "../shared/host";
import type { TaskMutationRunner } from "./task-mutation-runner";
import { requireActiveRepo } from "./task-operations-model";
import type { UseTaskOperationsResult } from "./task-operations-types";

type UseTaskPullRequestOperationsArgs = {
  activeRepoPath: string | null;
  refreshTaskData: UseTaskOperationsResult["refreshTaskData"];
  runTaskMutation: TaskMutationRunner["runTaskMutation"];
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
  refreshTaskData,
  runTaskMutation,
}: UseTaskPullRequestOperationsArgs): TaskPullRequestOperations {
  const [detectingPullRequestTaskId, setDetectingPullRequestTaskId] = useState<string | null>(null);
  const [linkingMergedPullRequestTaskId, setLinkingMergedPullRequestTaskId] = useState<
    string | null
  >(null);
  const [unlinkingPullRequestTaskId, setUnlinkingPullRequestTaskId] = useState<string | null>(null);
  const [pendingMergedPullRequest, setPendingMergedPullRequest] = useState<{
    taskId: string;
    pullRequest: PullRequest;
  } | null>(null);
  const previousActiveRepoPathRef = useRef(activeRepoPath);

  const clearPullRequestState = useCallback(() => {
    setDetectingPullRequestTaskId(null);
    setLinkingMergedPullRequestTaskId(null);
    setUnlinkingPullRequestTaskId(null);
    setPendingMergedPullRequest(null);
  }, []);

  useEffect(() => {
    if (previousActiveRepoPathRef.current !== activeRepoPath) {
      previousActiveRepoPathRef.current = activeRepoPath;
      clearPullRequestState();
    }
  }, [activeRepoPath, clearPullRequestState]);

  const syncPullRequests = useCallback(
    async (taskId: string): Promise<void> => {
      setDetectingPullRequestTaskId(taskId);
      try {
        const repoPath = requireActiveRepo(activeRepoPath);
        const result = await host.taskPullRequestDetect(repoPath, taskId);
        if (result.outcome === "linked") {
          await refreshTaskData(repoPath, taskId);
          toast.success("Pull request linked", { description: `PR #${result.pullRequest.number}` });
          return;
        }
        if (result.outcome === "merged") {
          setPendingMergedPullRequest({ taskId, pullRequest: result.pullRequest });
          return;
        }
        toast.warning("No pull request found", {
          description: `No open GitHub pull request found for ${result.sourceBranch}.`,
        });
      } catch (error) {
        toast.error("Failed to detect pull request", { description: errorMessage(error) });
      } finally {
        setDetectingPullRequestTaskId((currentTaskId) =>
          currentTaskId === taskId ? null : currentTaskId,
        );
      }
    },
    [activeRepoPath, refreshTaskData],
  );

  const cancelLinkMergedPullRequest = useCallback((): void => {
    if (linkingMergedPullRequestTaskId != null) {
      return;
    }
    setPendingMergedPullRequest(null);
  }, [linkingMergedPullRequestTaskId]);

  const linkMergedPullRequest = useCallback(async (): Promise<void> => {
    if (!pendingMergedPullRequest) {
      toast.error("Merged pull request state expired", {
        description: "Re-run pull request detection and try again.",
      });
      return;
    }

    const { taskId, pullRequest } = pendingMergedPullRequest;
    setLinkingMergedPullRequestTaskId(taskId);
    try {
      const repoPath = requireActiveRepo(activeRepoPath);
      await host.taskPullRequestLinkMerged(repoPath, taskId, pullRequest);
      setPendingMergedPullRequest((current) => (current?.taskId === taskId ? null : current));
      await refreshTaskData(repoPath, taskId);
      toast.success("Merged pull request linked", {
        description: `PR #${pullRequest.number}; task moved to Done.`,
      });
    } catch (error) {
      toast.error("Failed to link merged pull request", { description: errorMessage(error) });
    } finally {
      setLinkingMergedPullRequestTaskId((currentTaskId) =>
        currentTaskId === taskId ? null : currentTaskId,
      );
    }
  }, [activeRepoPath, pendingMergedPullRequest, refreshTaskData]);

  const unlinkPullRequest = useCallback(
    async (taskId: string): Promise<void> => {
      setUnlinkingPullRequestTaskId(taskId);
      try {
        await runTaskMutation({
          refreshStrategy: { kind: "task", taskId },
          run: async (repoPath) => {
            await host.taskPullRequestUnlink(repoPath, taskId);
          },
          successTitle: "Pull request unlinked",
          successDescription: taskId,
          failureTitle: "Failed to unlink pull request",
        }).catch(() => {
          // runTaskMutation already surfaced the actionable error to the user.
        });
      } finally {
        setUnlinkingPullRequestTaskId((currentTaskId) =>
          currentTaskId === taskId ? null : currentTaskId,
        );
      }
    },
    [runTaskMutation],
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
