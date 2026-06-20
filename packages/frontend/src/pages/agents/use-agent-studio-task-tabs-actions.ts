import { type Dispatch, type SetStateAction, useCallback } from "react";
import { closeTaskTab, reorderTaskTabs } from "./agent-studio-task-tabs-list";

type SetState<T> = Dispatch<SetStateAction<T>>;

const focusTaskTabTrigger = (taskId: string): void => {
  globalThis.setTimeout(() => {
    if (typeof globalThis.document === "undefined") {
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
  setOpenTaskTabs: SetState<string[]>;
  setPersistedActiveTaskId: SetState<string | null>;
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
    setOpenTaskTabs,
    setPersistedActiveTaskId,
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

      setOpenTaskTabs(nextTabTaskIds);
      setPersistedActiveTaskId(nextActiveTaskId ?? null);

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
    [
      activeTaskTabId,
      clearTaskSelection,
      selectTask,
      setOpenTaskTabs,
      setPersistedActiveTaskId,
      tabTaskIds,
    ],
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

      setOpenTaskTabs(nextTabTaskIds);
    },
    [setOpenTaskTabs, tabTaskIds],
  );

  return {
    handleCreateTab,
    handleCloseTab,
    handleReorderTab,
  };
}
