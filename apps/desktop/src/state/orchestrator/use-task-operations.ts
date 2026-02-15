import { errorMessage, phaseToStatus, summarizeTaskLoadError } from "@/state/orchestrator-helpers";
import {
  type BeadsCheck,
  type RunSummary,
  type TaskCard,
  type TaskCreateInput,
  type TaskPhase,
  type TaskUpdatePatch,
  taskPhaseSchema,
} from "@openblueprint/contracts";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { host } from "./host";

type UseTaskOperationsArgs = {
  activeRepo: string | null;
  setStatusText: (value: string) => void;
  refreshBeadsCheckForRepo: (repoPath: string, force?: boolean) => Promise<BeadsCheck>;
};

type UseTaskOperationsResult = {
  tasks: TaskCard[];
  runs: RunSummary[];
  isLoadingTasks: boolean;
  setIsLoadingTasks: (value: boolean) => void;
  setTasks: (tasks: TaskCard[]) => void;
  setRuns: (runs: RunSummary[]) => void;
  clearTaskData: () => void;
  refreshTaskData: (repoPath: string) => Promise<void>;
  refreshTasks: () => Promise<void>;
  createTask: (input: TaskCreateInput) => Promise<void>;
  updateTask: (taskId: string, patch: TaskUpdatePatch) => Promise<void>;
  setTaskPhase: (taskId: string, phase: TaskPhase) => Promise<void>;
};

export function useTaskOperations({
  activeRepo,
  setStatusText,
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
    setTasks(taskList);
    setRuns(runList);
  }, []);

  const refreshTasks = useCallback(async (): Promise<void> => {
    if (!activeRepo) {
      return;
    }

    setIsLoadingTasks(true);
    setStatusText(`Refreshing tasks for ${activeRepo}...`);
    try {
      const beads = await refreshBeadsCheckForRepo(activeRepo, false);
      if (!beads.beadsOk) {
        const details = beads.beadsError ?? "Beads store is not initialized for this repository.";
        setStatusText(`Task store unavailable. ${details}`);
        return;
      }

      await refreshTaskData(activeRepo);
      setStatusText("Tasks refreshed");
    } catch (error) {
      setStatusText(summarizeTaskLoadError(error));
    } finally {
      setIsLoadingTasks(false);
    }
  }, [activeRepo, refreshBeadsCheckForRepo, refreshTaskData, setStatusText]);

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
        setStatusText("Task created");
        await refreshTaskData(activeRepo);
        toast.success("Task created", {
          description: input.title.trim(),
        });
      } catch (error) {
        const reason = errorMessage(error);
        setStatusText(`Failed to create task: ${reason}`);
        toast.error("Failed to create task", {
          description: reason,
        });
        throw error;
      }
    },
    [activeRepo, refreshTaskData, setStatusText],
  );

  const updateTask = useCallback(
    async (taskId: string, patch: TaskUpdatePatch): Promise<void> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      try {
        await host.taskUpdate(activeRepo, taskId, patch);
        setStatusText(`Task ${taskId} updated`);
        await refreshTaskData(activeRepo);
        toast.success("Task updated", {
          description: patch.title?.trim() || taskId,
        });
      } catch (error) {
        const reason = errorMessage(error);
        setStatusText(`Failed to update task ${taskId}: ${reason}`);
        toast.error("Failed to update task", {
          description: reason,
        });
        throw error;
      }
    },
    [activeRepo, refreshTaskData, setStatusText],
  );

  const setTaskPhase = useCallback(
    async (taskId: string, phase: TaskPhase): Promise<void> => {
      if (!activeRepo) {
        throw new Error("Select a workspace first.");
      }

      taskPhaseSchema.parse(phase);
      await host.taskSetPhase(activeRepo, taskId, phase, "Kanban move");
      await host.taskUpdate(activeRepo, taskId, { status: phaseToStatus(phase) });
      setStatusText(`Task ${taskId} moved to ${phase}`);
      await refreshTaskData(activeRepo);
    },
    [activeRepo, refreshTaskData, setStatusText],
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
    setTasks,
    setRuns,
    clearTaskData,
    refreshTaskData,
    refreshTasks,
    createTask,
    updateTask,
    setTaskPhase,
  };
}
