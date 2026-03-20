import type {
  BeadsCheck,
  PullRequest,
  RunSummary,
  TaskCard,
  TaskCreateInput,
  TaskStatus,
  TaskUpdatePatch,
} from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { appQueryClient } from "@/lib/query-client";
import { documentQueryKeys } from "@/state/queries/documents";
import { summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import { agentSessionQueryKeys } from "../../queries/agent-sessions";
import { invalidateRepoTaskQueries, loadRepoTaskDataFromQuery } from "../../queries/tasks";
import { host } from "../shared/host";
import {
  DEFERRED_BY_USER_REASON,
  requireActiveRepo,
  toNormalizedTitle,
  toUpdateSuccessDescription,
} from "./task-operations-model";

type UseTaskOperationsArgs = {
  activeRepo: string | null;
  refreshBeadsCheckForRepo: (repoPath: string, force?: boolean) => Promise<BeadsCheck>;
};

type UseTaskOperationsResult = {
  tasks: TaskCard[];
  runs: RunSummary[];
  isLoadingTasks: boolean;
  detectingPullRequestTaskId: string | null;
  linkingMergedPullRequestTaskId: string | null;
  unlinkingPullRequestTaskId: string | null;
  pendingMergedPullRequest: { taskId: string; pullRequest: PullRequest } | null;
  setIsLoadingTasks: (value: boolean) => void;
  clearTaskData: () => void;
  refreshTaskData: (repoPath: string) => Promise<void>;
  refreshTasks: () => Promise<void>;
  syncPullRequests: (taskId: string) => Promise<void>;
  linkMergedPullRequest: () => Promise<void>;
  cancelLinkMergedPullRequest: () => void;
  unlinkPullRequest: (taskId: string) => Promise<void>;
  createTask: (input: TaskCreateInput) => Promise<void>;
  updateTask: (taskId: string, patch: TaskUpdatePatch) => Promise<void>;
  deleteTask: (taskId: string, deleteSubtasks?: boolean) => Promise<void>;
  resetTaskImplementation: (taskId: string) => Promise<void>;
  transitionTask: (taskId: string, status: TaskStatus, reason?: string) => Promise<void>;
  deferTask: (taskId: string) => Promise<void>;
  resumeDeferredTask: (taskId: string) => Promise<void>;
  humanApproveTask: (taskId: string) => Promise<void>;
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
};

export function useTaskOperations({
  activeRepo,
  refreshBeadsCheckForRepo,
}: UseTaskOperationsArgs): UseTaskOperationsResult {
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [detectingPullRequestTaskId, setDetectingPullRequestTaskId] = useState<string | null>(null);
  const [linkingMergedPullRequestTaskId, setLinkingMergedPullRequestTaskId] = useState<
    string | null
  >(null);
  const [unlinkingPullRequestTaskId, setUnlinkingPullRequestTaskId] = useState<string | null>(null);
  const [pendingMergedPullRequest, setPendingMergedPullRequest] = useState<{
    taskId: string;
    pullRequest: PullRequest;
  } | null>(null);
  const activeRepoRef = useRef(activeRepo);

  useEffect(() => {
    const previousActiveRepo = activeRepoRef.current;
    activeRepoRef.current = activeRepo;
    if (previousActiveRepo !== activeRepo) {
      setDetectingPullRequestTaskId(null);
      setLinkingMergedPullRequestTaskId(null);
      setUnlinkingPullRequestTaskId(null);
      setPendingMergedPullRequest(null);
    }
  }, [activeRepo]);

  const refreshTaskData = useCallback(async (repoPath: string): Promise<void> => {
    await invalidateRepoTaskQueries(appQueryClient, repoPath);
    const { tasks: taskList, runs: runList } = await loadRepoTaskDataFromQuery(
      appQueryClient,
      repoPath,
    );
    if (activeRepoRef.current !== repoPath) {
      return;
    }
    setTasks(taskList);
    setRuns(runList);
  }, []);

  const runTaskMutation = useCallback(
    async (options: {
      run: (repoPath: string) => Promise<void>;
      successTitle?: string;
      successDescription: string;
      failureTitle: string;
    }): Promise<void> => {
      try {
        const repoPath = requireActiveRepo(activeRepo);
        await options.run(repoPath);
        await refreshTaskData(repoPath);
        if (options.successTitle) {
          toast.success(options.successTitle, {
            description: options.successDescription,
          });
        }
      } catch (error) {
        toast.error(options.failureTitle, {
          description: errorMessage(error),
        });
        throw error;
      }
    },
    [activeRepo, refreshTaskData],
  );

  const refreshTasks = useCallback(async (): Promise<void> => {
    if (!activeRepo) {
      return;
    }

    setIsLoadingTasks(true);
    try {
      const beads = await refreshBeadsCheckForRepo(activeRepo, false);
      if (!beads.beadsOk) {
        const details = beads.beadsError ?? "Beads store is not initialized for this repository.";
        toast.error("Task store unavailable", { description: details });
        return;
      }

      try {
        await host.repoPullRequestSync(activeRepo);
      } catch (error) {
        console.warn("Pull request sync failed during task refresh", errorMessage(error));
      }
      await refreshTaskData(activeRepo);
    } catch (error) {
      toast.error("Failed to refresh tasks", {
        description: summarizeTaskLoadError(error),
      });
    } finally {
      setIsLoadingTasks(false);
    }
  }, [activeRepo, refreshBeadsCheckForRepo, refreshTaskData]);

  const syncPullRequests = useCallback(
    async (taskId: string): Promise<void> => {
      setDetectingPullRequestTaskId(taskId);
      try {
        const repoPath = requireActiveRepo(activeRepo);
        const result = await host.taskPullRequestDetect(repoPath, taskId);
        if (result.outcome === "linked") {
          await refreshTaskData(repoPath);
          toast.success("Pull request linked", {
            description: `PR #${result.pullRequest.number}`,
          });
          return;
        }
        if (result.outcome === "merged") {
          setPendingMergedPullRequest({
            taskId,
            pullRequest: result.pullRequest,
          });
          return;
        }
        toast.warning("No pull request found", {
          description: `No open GitHub pull request found for ${result.sourceBranch}.`,
        });
      } catch (error) {
        toast.error("Failed to detect pull request", {
          description: errorMessage(error),
        });
      } finally {
        setDetectingPullRequestTaskId((currentTaskId) =>
          currentTaskId === taskId ? null : currentTaskId,
        );
      }
    },
    [activeRepo, refreshTaskData],
  );

  const cancelLinkMergedPullRequest = useCallback((): void => {
    if (linkingMergedPullRequestTaskId != null) {
      return;
    }
    setPendingMergedPullRequest(null);
  }, [linkingMergedPullRequestTaskId]);

  const linkMergedPullRequest = useCallback(async (): Promise<void> => {
    if (!pendingMergedPullRequest) {
      return;
    }

    const { taskId, pullRequest } = pendingMergedPullRequest;
    setLinkingMergedPullRequestTaskId(taskId);
    try {
      const repoPath = requireActiveRepo(activeRepo);
      await host.taskPullRequestLinkMerged(repoPath, taskId, pullRequest);
      setPendingMergedPullRequest((current) => (current?.taskId === taskId ? null : current));
      await refreshTaskData(repoPath);
      toast.success("Merged pull request linked", {
        description: `PR #${pullRequest.number}; task moved to Done.`,
      });
    } catch (error) {
      toast.error("Failed to link merged pull request", {
        description: errorMessage(error),
      });
    } finally {
      setLinkingMergedPullRequestTaskId((currentTaskId) =>
        currentTaskId === taskId ? null : currentTaskId,
      );
    }
  }, [activeRepo, pendingMergedPullRequest, refreshTaskData]);

  const unlinkPullRequest = useCallback(
    async (taskId: string): Promise<void> => {
      setUnlinkingPullRequestTaskId(taskId);
      try {
        await runTaskMutation({
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

  const createTask = useCallback(
    async (input: TaskCreateInput): Promise<void> => {
      requireActiveRepo(activeRepo);

      const title = toNormalizedTitle(input.title);
      if (!title) {
        return;
      }

      await runTaskMutation({
        run: async (repoPath) => {
          await host.taskCreate(repoPath, {
            ...input,
            title,
          });
        },
        successTitle: "Task created",
        successDescription: title,
        failureTitle: "Failed to create task",
      });
    },
    [activeRepo, runTaskMutation],
  );

  const updateTask = useCallback(
    async (taskId: string, patch: TaskUpdatePatch): Promise<void> => {
      await runTaskMutation({
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

  const deleteTask = useCallback(
    async (taskId: string, deleteSubtasks = false): Promise<void> => {
      await runTaskMutation({
        run: async (repoPath) => {
          await host.taskDelete(repoPath, taskId, deleteSubtasks);
        },
        successTitle: "Task deleted",
        successDescription: taskId,
        failureTitle: "Failed to delete task",
      });
    },
    [runTaskMutation],
  );

  const resetTaskImplementation = useCallback(
    async (taskId: string): Promise<void> => {
      const repoPath = requireActiveRepo(activeRepo);
      try {
        await host.taskResetImplementation(repoPath, taskId);
        await Promise.all([
          appQueryClient.invalidateQueries({
            queryKey: agentSessionQueryKeys.list(repoPath, taskId),
            exact: true,
            refetchType: "none",
          }),
          appQueryClient.invalidateQueries({
            queryKey: documentQueryKeys.qaReport(repoPath, taskId),
            exact: true,
            refetchType: "none",
          }),
          appQueryClient.invalidateQueries({
            queryKey: documentQueryKeys.spec(repoPath, taskId),
            exact: true,
            refetchType: "none",
          }),
          appQueryClient.invalidateQueries({
            queryKey: documentQueryKeys.plan(repoPath, taskId),
            exact: true,
            refetchType: "none",
          }),
        ]);
        await refreshTaskData(repoPath);
        toast.success("Implementation reset", {
          description: taskId,
        });
      } catch (error) {
        toast.error("Failed to reset implementation", {
          description: errorMessage(error),
        });
        throw error;
      }
    },
    [activeRepo, refreshTaskData],
  );

  const transitionTask = useCallback(
    async (taskId: string, status: TaskStatus, reason?: string): Promise<void> => {
      await runTaskMutation({
        run: async (repoPath) => {
          await host.taskTransition(repoPath, taskId, status, reason);
        },
        successDescription: taskId,
        failureTitle: "Failed to transition task",
      });
    },
    [runTaskMutation],
  );

  const deferTask = useCallback(
    async (taskId: string): Promise<void> => {
      await runTaskMutation({
        run: async (repoPath) => {
          await host.taskDefer(repoPath, taskId, DEFERRED_BY_USER_REASON);
        },
        successTitle: "Task deferred",
        successDescription: taskId,
        failureTitle: "Failed to defer task",
      });
    },
    [runTaskMutation],
  );

  const resumeDeferredTask = useCallback(
    async (taskId: string): Promise<void> => {
      await runTaskMutation({
        run: async (repoPath) => {
          await host.taskResumeDeferred(repoPath, taskId);
        },
        successTitle: "Task resumed",
        successDescription: taskId,
        failureTitle: "Failed to resume task",
      });
    },
    [runTaskMutation],
  );

  const humanApproveTask = useCallback(
    async (taskId: string): Promise<void> => {
      await runTaskMutation({
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

  const clearTaskData = useCallback(() => {
    setTasks([]);
    setRuns([]);
    setIsLoadingTasks(false);
    setDetectingPullRequestTaskId(null);
    setLinkingMergedPullRequestTaskId(null);
    setUnlinkingPullRequestTaskId(null);
    setPendingMergedPullRequest(null);
  }, []);

  return {
    tasks,
    runs,
    isLoadingTasks,
    detectingPullRequestTaskId,
    linkingMergedPullRequestTaskId,
    unlinkingPullRequestTaskId,
    pendingMergedPullRequest,
    setIsLoadingTasks,
    clearTaskData,
    refreshTaskData,
    refreshTasks,
    syncPullRequests,
    linkMergedPullRequest,
    cancelLinkMergedPullRequest,
    unlinkPullRequest,
    createTask,
    updateTask,
    deleteTask,
    resetTaskImplementation,
    transitionTask,
    deferTask,
    resumeDeferredTask,
    humanApproveTask,
    humanRequestChangesTask,
  };
}
