import type { TaskCard, WorkspaceAgentStudioState } from "@openducktor/contracts";
import { type Dispatch, type SetStateAction, useEffect } from "react";
import { reconcileAgentStudioOpenTaskIds } from "./agent-studio-workspace-state";

type SetState<T> = Dispatch<SetStateAction<T>>;

type UseTaskTabStateArgs = {
  activeWorkspaceId: string | null;
  agentStudioState: WorkspaceAgentStudioState | null;
  taskId: string;
  selectedTask: TaskCard | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  loadedStateWorkspaceId: string | null;
  setOpenTaskTabs: SetState<string[]>;
  setPersistedActiveTaskId: SetState<string | null>;
  setLoadedStateWorkspaceId: SetState<string | null>;
};

export function useTaskTabState({
  activeWorkspaceId,
  agentStudioState,
  taskId,
  selectedTask,
  tasks,
  isLoadingTasks,
  loadedStateWorkspaceId,
  setOpenTaskTabs,
  setPersistedActiveTaskId,
  setLoadedStateWorkspaceId,
}: UseTaskTabStateArgs): void {
  useEffect(() => {
    if (!activeWorkspaceId) {
      setOpenTaskTabs([]);
      setPersistedActiveTaskId(null);
      setLoadedStateWorkspaceId(null);
      return;
    }
    if (!agentStudioState || loadedStateWorkspaceId === activeWorkspaceId) {
      return;
    }

    setOpenTaskTabs(agentStudioState.openTaskIds);
    setPersistedActiveTaskId(agentStudioState.activeTask?.taskId ?? null);
    setLoadedStateWorkspaceId(activeWorkspaceId);
  }, [
    activeWorkspaceId,
    agentStudioState,
    loadedStateWorkspaceId,
    setLoadedStateWorkspaceId,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
  ]);

  useEffect(() => {
    if (isLoadingTasks || loadedStateWorkspaceId !== activeWorkspaceId) {
      return;
    }
    setOpenTaskTabs((current) => {
      const reconciled = reconcileAgentStudioOpenTaskIds(current, tasks);
      if (
        reconciled.length === current.length &&
        reconciled.every((taskId, index) => taskId === current[index])
      ) {
        return current;
      }
      return reconciled;
    });
  }, [activeWorkspaceId, isLoadingTasks, loadedStateWorkspaceId, setOpenTaskTabs, tasks]);

  useEffect(() => {
    if (
      !taskId ||
      !selectedTask ||
      selectedTask.status === "closed" ||
      loadedStateWorkspaceId !== activeWorkspaceId
    ) {
      return;
    }
    setOpenTaskTabs((current) => {
      if (current.includes(taskId)) {
        return current;
      }
      return [...current, taskId];
    });
  }, [activeWorkspaceId, loadedStateWorkspaceId, selectedTask, setOpenTaskTabs, taskId]);
}
