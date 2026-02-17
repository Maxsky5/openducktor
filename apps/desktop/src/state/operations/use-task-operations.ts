import { errorMessage } from "@/lib/errors";
import { summarizeTaskLoadError } from "@/state/tasks/task-load-errors";
import {
  type BeadsCheck,
  type RunSummary,
  type TaskCard,
  type TaskCreateInput,
  type TaskStatus,
  type TaskUpdatePatch,
} from "@openblueprint/contracts";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { host } from "./host";

type UseTaskOperationsArgs = {
  activeRepo: string | null;
  refreshBeadsCheckForRepo: (repoPath: string, force?: boolean) => Promise<BeadsCheck>;
};

type UseTaskOperationsResult = {
  tasks: TaskCard[];
  runs: RunSummary[];
  isLoadingTasks: boolean;
  setIsLoadingTasks: (value: boolean) => void;
  clearTaskData: () => void;
  refreshTaskData: (repoPath: string) => Promise<void>;
  refreshTasks: () => Promise<void>;
  createTask: (input: TaskCreateInput) => Promise<void>;
  updateTask: (taskId: string, patch: TaskUpdatePatch) => Promise<void>;
  transitionTask: (taskId: string, status: TaskStatus, reason?: string) => Promise<void>;
  deferTask: (taskId: string) => Promise<void>;
  resumeDeferredTask: (taskId: string) => Promise<void>;
};

export function useTaskOperations({
  activeRepo,
  refreshBeadsCheckForRepo,
}: UseTaskOperationsArgs): UseTaskOperationsResult {
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);

  const refreshTaskData = useCallback(async (repoPath: string): Promise<void> => {
    const [taskList, runList] = await Promise.all([
      host.tasksList(repoPath),
      host.runsList(repoPath),
    ]);
    setTasks(taskList.filter((task) => task.status !== "deferred"));
    setRuns(runList);
  }, []);

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

      await refreshTaskData(activeRepo);
    } catch (error) {
      toast.error("Failed to refresh tasks", {
        description: summarizeTaskLoadError(error),
      });
    } finally {
      setIsLoadingTasks(false);
    }
  }, [activeRepo, refreshBeadsCheckForRepo, refreshTaskData]);

  const createTask = useCallback(
    async (input: TaskCreateInput): Promise<void> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }
      if (!input.title.trim()) {
        return;
      }

      try {
        await host.taskCreate(activeRepo, {
          ...input,
          title: input.title.trim(),
        });
        await refreshTaskData(activeRepo);
        toast.success("Task created", {
          description: input.title.trim(),
        });
      } catch (error) {
        const reason = errorMessage(error);
        toast.error("Failed to create task", {
          description: reason,
        });
        throw error;
      }
    },
    [activeRepo, refreshTaskData],
  );

  const updateTask = useCallback(
    async (taskId: string, patch: TaskUpdatePatch): Promise<void> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      try {
        await host.taskUpdate(activeRepo, taskId, patch);
        await refreshTaskData(activeRepo);
        toast.success("Task updated", {
          description: patch.title?.trim() || taskId,
        });
      } catch (error) {
        const reason = errorMessage(error);
        toast.error("Failed to update task", {
          description: reason,
        });
        throw error;
      }
    },
    [activeRepo, refreshTaskData],
  );

  const transitionTask = useCallback(
    async (taskId: string, status: TaskStatus, reason?: string): Promise<void> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      try {
        await host.taskTransition(activeRepo, taskId, status, reason);
        await refreshTaskData(activeRepo);
      } catch (error) {
        const reason = errorMessage(error);
        toast.error("Failed to transition task", {
          description: reason,
        });
        throw error;
      }
    },
    [activeRepo, refreshTaskData],
  );

  const deferTask = useCallback(
    async (taskId: string): Promise<void> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      try {
        await host.taskDefer(activeRepo, taskId, "Deferred by user");
        await refreshTaskData(activeRepo);
        toast.success("Task deferred", {
          description: taskId,
        });
      } catch (error) {
        const reason = errorMessage(error);
        toast.error("Failed to defer task", {
          description: reason,
        });
        throw error;
      }
    },
    [activeRepo, refreshTaskData],
  );

  const resumeDeferredTask = useCallback(
    async (taskId: string): Promise<void> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      try {
        await host.taskResumeDeferred(activeRepo, taskId);
        await refreshTaskData(activeRepo);
        toast.success("Task resumed", {
          description: taskId,
        });
      } catch (error) {
        const reason = errorMessage(error);
        toast.error("Failed to resume task", {
          description: reason,
        });
        throw error;
      }
    },
    [activeRepo, refreshTaskData],
  );

  const clearTaskData = useCallback(() => {
    setTasks([]);
    setRuns([]);
    setIsLoadingTasks(false);
  }, []);

  return {
    tasks,
    runs,
    isLoadingTasks,
    setIsLoadingTasks,
    clearTaskData,
    refreshTaskData,
    refreshTasks,
    createTask,
    updateTask,
    transitionTask,
    deferTask,
    resumeDeferredTask,
  };
}
