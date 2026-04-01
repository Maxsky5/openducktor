import type {
  BeadsCheck,
  PullRequest,
  RunSummary,
  TaskCard,
  TaskCreateInput,
  TaskStatus,
  TaskUpdatePatch,
} from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import type { TaskRefreshOptions } from "@/state/app-state-contexts";
import { documentQueryKeys } from "@/state/queries/documents";
import { refreshRepoTaskViewsFromQuery } from "@/state/queries/task-view-sync";
import { summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import { agentSessionQueryKeys } from "../../queries/agent-sessions";
import { repoTaskDataQueryOptions } from "../../queries/tasks";
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
  refreshTaskData: (repoPath: string, taskId?: string) => Promise<void>;
  refreshTasksWithOptions: (options?: TaskRefreshOptions) => Promise<void>;
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

type TaskMutationRefreshStrategy =
  | { kind: "repo" }
  | { kind: "task"; taskId: string }
  | { kind: "remove-task"; taskIds: string[] };

const collectTaskDeletionIds = (
  tasks: TaskCard[],
  taskId: string,
  deleteSubtasks: boolean,
): string[] => {
  if (!deleteSubtasks) {
    return [taskId];
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const collectedIds: string[] = [];
  const pendingIds = [taskId];
  const seenIds = new Set<string>();

  while (pendingIds.length > 0) {
    const currentId = pendingIds.shift();
    if (!currentId || seenIds.has(currentId)) {
      continue;
    }

    seenIds.add(currentId);
    collectedIds.push(currentId);

    for (const subtaskId of taskById.get(currentId)?.subtaskIds ?? []) {
      if (!seenIds.has(subtaskId)) {
        pendingIds.push(subtaskId);
      }
    }
  }

  return collectedIds;
};

export function useTaskOperations({
  activeRepo,
  refreshBeadsCheckForRepo,
}: UseTaskOperationsArgs): UseTaskOperationsResult {
  const queryClient = useQueryClient();
  const [isManualLoadingTasks, setIsManualLoadingTasks] = useState(false);
  const inFlightTaskRefreshRef = useRef<{ repoPath: string; promise: Promise<void> } | null>(null);
  const lastScheduledTaskRefreshErrorRef = useRef<{
    repoPath: string;
    description: string;
  } | null>(null);
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
  const repoTaskDataQuery = useQuery({
    ...repoTaskDataQueryOptions(activeRepo ?? "__disabled__"),
    enabled: activeRepo !== null,
  });

  useEffect(() => {
    const previousActiveRepo = activeRepoRef.current;
    activeRepoRef.current = activeRepo;
    if (previousActiveRepo !== activeRepo) {
      setIsManualLoadingTasks(false);
      lastScheduledTaskRefreshErrorRef.current = null;
      setDetectingPullRequestTaskId(null);
      setLinkingMergedPullRequestTaskId(null);
      setUnlinkingPullRequestTaskId(null);
      setPendingMergedPullRequest(null);
    }
  }, [activeRepo]);

  const refreshTaskData = useCallback(
    async (repoPath: string, taskId?: string): Promise<void> => {
      await refreshRepoTaskViewsFromQuery(
        queryClient,
        repoPath,
        taskId ? { taskDocumentStrategy: "refresh", taskId } : undefined,
      );
    },
    [queryClient],
  );

  const runRepoTaskRefresh = useCallback(
    async (repoPath: string): Promise<void> => {
      const beads = await refreshBeadsCheckForRepo(repoPath, false);
      if (!beads.beadsOk) {
        throw new Error(beads.beadsError ?? "Beads store is not initialized for this repository.");
      }

      await host.repoPullRequestSync(repoPath);
      await refreshTaskData(repoPath);
    },
    [refreshBeadsCheckForRepo, refreshTaskData],
  );

  const getRepoTaskRefreshPromise = useCallback(
    (repoPath: string): Promise<void> => {
      const inFlightRefresh = inFlightTaskRefreshRef.current;
      if (inFlightRefresh && inFlightRefresh.repoPath === repoPath) {
        return inFlightRefresh.promise;
      }

      const promise = runRepoTaskRefresh(repoPath).finally(() => {
        if (inFlightTaskRefreshRef.current?.promise === promise) {
          inFlightTaskRefreshRef.current = null;
        }
      });
      inFlightTaskRefreshRef.current = { repoPath, promise };
      return promise;
    },
    [runRepoTaskRefresh],
  );

  const refreshTaskMutationViews = useCallback(
    async (repoPath: string, strategy: TaskMutationRefreshStrategy): Promise<void> => {
      if (strategy.kind === "task") {
        await refreshRepoTaskViewsFromQuery(queryClient, repoPath, {
          taskDocumentStrategy: "refresh",
          taskId: strategy.taskId,
        });
        return;
      }

      if (strategy.kind === "remove-task") {
        await refreshRepoTaskViewsFromQuery(queryClient, repoPath, {
          taskDocumentStrategy: "remove",
          taskIds: strategy.taskIds,
        });
        return;
      }

      await refreshRepoTaskViewsFromQuery(queryClient, repoPath);
    },
    [queryClient],
  );

  const runTaskMutation = useCallback(
    async (options: {
      refreshStrategy: TaskMutationRefreshStrategy;
      run: (repoPath: string) => Promise<void>;
      successTitle?: string;
      successDescription: string;
      failureTitle: string;
    }): Promise<void> => {
      try {
        const repoPath = requireActiveRepo(activeRepo);
        await options.run(repoPath);
        await refreshTaskMutationViews(repoPath, options.refreshStrategy);
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
    [activeRepo, refreshTaskMutationViews],
  );

  const refreshTasksWithOptions = useCallback(
    async (options?: TaskRefreshOptions): Promise<void> => {
      if (!activeRepo) {
        return;
      }

      const repoPath = activeRepo;
      const trigger = options?.trigger ?? "manual";
      if (trigger === "manual") {
        setIsManualLoadingTasks(true);
      }

      try {
        await getRepoTaskRefreshPromise(repoPath);
        lastScheduledTaskRefreshErrorRef.current = null;
      } catch (error) {
        const description = summarizeTaskLoadError(error);
        if (trigger === "scheduled") {
          const lastError = lastScheduledTaskRefreshErrorRef.current;
          if (lastError?.repoPath !== repoPath || lastError.description !== description) {
            lastScheduledTaskRefreshErrorRef.current = { repoPath, description };
            toast.error("Failed to refresh tasks", { description });
          }
        } else {
          toast.error("Failed to refresh tasks", {
            description,
          });
        }
      } finally {
        if (trigger === "manual") {
          setIsManualLoadingTasks(false);
        }
      }
    },
    [activeRepo, getRepoTaskRefreshPromise],
  );

  const refreshTasks = useCallback(async (): Promise<void> => {
    await refreshTasksWithOptions({ trigger: "manual" });
  }, [refreshTasksWithOptions]);

  const syncPullRequests = useCallback(
    async (taskId: string): Promise<void> => {
      setDetectingPullRequestTaskId(taskId);
      try {
        const repoPath = requireActiveRepo(activeRepo);
        const result = await host.taskPullRequestDetect(repoPath, taskId);
        if (result.outcome === "linked") {
          await refreshTaskData(repoPath, taskId);
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
      toast.error("Merged pull request state expired", {
        description: "Re-run pull request detection and try again.",
      });
      return;
    }

    const { taskId, pullRequest } = pendingMergedPullRequest;
    setLinkingMergedPullRequestTaskId(taskId);
    try {
      const repoPath = requireActiveRepo(activeRepo);
      await host.taskPullRequestLinkMerged(repoPath, taskId, pullRequest);
      setPendingMergedPullRequest((current) => (current?.taskId === taskId ? null : current));
      await refreshTaskData(repoPath, taskId);
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

  const createTask = useCallback(
    async (input: TaskCreateInput): Promise<void> => {
      requireActiveRepo(activeRepo);

      const title = toNormalizedTitle(input.title);
      if (!title) {
        return;
      }

      await runTaskMutation({
        refreshStrategy: { kind: "repo" },
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

  const deleteTask = useCallback(
    async (taskId: string, deleteSubtasks = false): Promise<void> => {
      const taskIdsToRemove = collectTaskDeletionIds(
        repoTaskDataQuery.data?.tasks ?? [],
        taskId,
        deleteSubtasks,
      );
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
    [repoTaskDataQuery.data?.tasks, runTaskMutation],
  );

  const resetTaskImplementation = useCallback(
    async (taskId: string): Promise<void> => {
      const repoPath = requireActiveRepo(activeRepo);
      try {
        await host.taskResetImplementation(repoPath, taskId);
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: agentSessionQueryKeys.list(repoPath, taskId),
            exact: true,
            refetchType: "none",
          }),
          queryClient.invalidateQueries({
            queryKey: documentQueryKeys.qaReport(repoPath, taskId),
            exact: true,
            refetchType: "none",
          }),
          queryClient.invalidateQueries({
            queryKey: documentQueryKeys.spec(repoPath, taskId),
            exact: true,
            refetchType: "none",
          }),
          queryClient.invalidateQueries({
            queryKey: documentQueryKeys.plan(repoPath, taskId),
            exact: true,
            refetchType: "none",
          }),
        ]);
        await refreshTaskData(repoPath, taskId);
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
    [activeRepo, queryClient, refreshTaskData],
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

  const deferTask = useCallback(
    async (taskId: string): Promise<void> => {
      await runTaskMutation({
        refreshStrategy: { kind: "task", taskId },
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
        refreshStrategy: { kind: "task", taskId },
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

  const clearTaskData = useCallback(() => {
    setIsManualLoadingTasks(false);
    lastScheduledTaskRefreshErrorRef.current = null;
    setDetectingPullRequestTaskId(null);
    setLinkingMergedPullRequestTaskId(null);
    setUnlinkingPullRequestTaskId(null);
    setPendingMergedPullRequest(null);
  }, []);

  const tasks = activeRepo ? (repoTaskDataQuery.data?.tasks ?? []) : [];
  const runs = activeRepo ? (repoTaskDataQuery.data?.runs ?? []) : [];
  const isLoadingTasks =
    isManualLoadingTasks ||
    (activeRepo !== null && (repoTaskDataQuery.isPending || repoTaskDataQuery.isFetching));

  return {
    tasks,
    runs,
    isLoadingTasks,
    detectingPullRequestTaskId,
    linkingMergedPullRequestTaskId,
    unlinkingPullRequestTaskId,
    pendingMergedPullRequest,
    setIsLoadingTasks: setIsManualLoadingTasks,
    clearTaskData,
    refreshTaskData,
    refreshTasksWithOptions,
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
