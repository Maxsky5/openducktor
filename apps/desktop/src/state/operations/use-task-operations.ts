import type {
  BeadsCheck,
  RunSummary,
  TaskCard,
  TaskCreateInput,
  TaskStatus,
  TaskUpdatePatch,
} from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import { host } from "./host";
import {
  DEFERRED_BY_USER_REASON,
  requireActiveRepo,
  toNormalizedTitle,
  toUpdateSuccessDescription,
  toVisibleTasks,
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
  unlinkingPullRequestTaskId: string | null;
  setIsLoadingTasks: (value: boolean) => void;
  clearTaskData: () => void;
  refreshTaskData: (repoPath: string) => Promise<void>;
  refreshTasks: () => Promise<void>;
  syncPullRequests: (taskId: string) => Promise<void>;
  unlinkPullRequest: (taskId: string) => Promise<void>;
  createTask: (input: TaskCreateInput) => Promise<void>;
  updateTask: (taskId: string, patch: TaskUpdatePatch) => Promise<void>;
  deleteTask: (taskId: string, deleteSubtasks?: boolean) => Promise<void>;
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
  const [unlinkingPullRequestTaskId, setUnlinkingPullRequestTaskId] = useState<string | null>(null);
  const activeRepoRef = useRef(activeRepo);

  useEffect(() => {
    const previousActiveRepo = activeRepoRef.current;
    activeRepoRef.current = activeRepo;
    if (previousActiveRepo !== activeRepo) {
      setDetectingPullRequestTaskId(null);
      setUnlinkingPullRequestTaskId(null);
    }
  }, [activeRepo]);

  const refreshTaskData = useCallback(async (repoPath: string): Promise<void> => {
    const [taskList, runList] = await Promise.all([
      host.tasksList(repoPath),
      host.runsList(repoPath),
    ]);
    if (activeRepoRef.current !== repoPath) {
      return;
    }
    setTasks(toVisibleTasks(taskList));
    setRuns(runList);
  }, []);

  const runTaskMutation = useCallback(
    async (options: {
      run: (repoPath: string) => Promise<void>;
      successTitle?: string;
      successDescription: string;
      failureTitle: string;
    }): Promise<void> => {
      const repoPath = requireActiveRepo(activeRepo);
      try {
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
      const repoPath = requireActiveRepo(activeRepo);

      setDetectingPullRequestTaskId(taskId);
      try {
        const result = await host.taskPullRequestDetect(repoPath, taskId);
        if (result.outcome === "linked") {
          await refreshTaskData(repoPath);
          toast.success("Pull request linked", {
            description: `PR #${result.pullRequest.number}`,
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
        throw error;
      } finally {
        setDetectingPullRequestTaskId((currentTaskId) =>
          currentTaskId === taskId ? null : currentTaskId,
        );
      }
    },
    [activeRepo, refreshTaskData],
  );

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
    setUnlinkingPullRequestTaskId(null);
  }, []);

  return {
    tasks,
    runs,
    isLoadingTasks,
    detectingPullRequestTaskId,
    unlinkingPullRequestTaskId,
    setIsLoadingTasks,
    clearTaskData,
    refreshTaskData,
    refreshTasks,
    syncPullRequests,
    unlinkPullRequest,
    createTask,
    updateTask,
    deleteTask,
    transitionTask,
    deferTask,
    resumeDeferredTask,
    humanApproveTask,
    humanRequestChangesTask,
  };
}
