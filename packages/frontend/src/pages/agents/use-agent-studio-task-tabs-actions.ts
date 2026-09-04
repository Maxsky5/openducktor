import { useCallback } from "react";
import { closeTaskTab, reorderTaskTabs } from "./agent-studio-task-tabs-list";
import type { TaskTabStateUpdate } from "./use-agent-studio-task-tabs-state";

const focusTaskTabTrigger = (taskId: string): void => {
  globalThis.setTimeout(() => {
    if (globalThis.document === undefined) {
      return;
    }

    const nextTrigger = globalThis.document.getElementById(`agent-studio-tab-${taskId}`);
    if (nextTrigger instanceof HTMLElement) {
      nextTrigger.focus();
    }
  }, 0);
};

type UseTaskTabActionsArgs = {
  tabTaskIds: string[];
  activeTaskTabId: string;
  clearTaskSelection: () => void;
  selectTask: (taskId: string) => void;
  handleSelectTab: (nextTaskId: string) => void;
  updateTaskTabState: (state: TaskTabStateUpdate) => void;
};

type UseTaskTabActionsResult = {
  handleCreateTab: (nextTaskId: string) => void;
  handleCloseTab: (taskIdToClose: string) => void;
  handleReorderTab: (
    draggedTaskId: string,
    targetTaskId: string,
    position: "before" | "after",
  ) => void;
};

export function useTaskTabActions(args: UseTaskTabActionsArgs): UseTaskTabActionsResult {
  const {
    tabTaskIds,
    activeTaskTabId,
    clearTaskSelection,
    selectTask,
    handleSelectTab,
    updateTaskTabState,
  } = args;

  const handleCreateTab = useCallback(
    (nextTaskId: string): void => {
      handleSelectTab(nextTaskId);
    },
    [handleSelectTab],
  );

  const handleCloseTab = useCallback(
    (taskIdToClose: string): void => {
      const { nextTabTaskIds, nextActiveTaskId } = closeTaskTab({
        tabTaskIds,
        taskIdToClose,
        activeTaskId: activeTaskTabId,
      });

      if (nextTabTaskIds === tabTaskIds) {
        return;
      }

      updateTaskTabState({
        openTaskIds: nextTabTaskIds,
        activeTaskId: nextActiveTaskId,
      });

      if (taskIdToClose !== activeTaskTabId) {
        return;
      }

      if (!nextActiveTaskId) {
        clearTaskSelection();
        return;
      }

      focusTaskTabTrigger(nextActiveTaskId);
      selectTask(nextActiveTaskId);
    },
    [activeTaskTabId, clearTaskSelection, selectTask, tabTaskIds, updateTaskTabState],
  );

  const handleReorderTab = useCallback(
    (draggedTaskId: string, targetTaskId: string, position: "before" | "after"): void => {
      const nextTabTaskIds = reorderTaskTabs({
        tabTaskIds,
        draggedTaskId,
        targetTaskId,
        position,
      });

      if (nextTabTaskIds === tabTaskIds) {
        return;
      }

      updateTaskTabState({
        openTaskIds: nextTabTaskIds,
        activeTaskId: activeTaskTabId || null,
      });
    },
    [activeTaskTabId, tabTaskIds, updateTaskTabState],
  );

  return {
    handleCreateTab,
    handleCloseTab,
    handleReorderTab,
  };
}
