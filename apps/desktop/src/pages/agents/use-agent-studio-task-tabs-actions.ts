import { type Dispatch, type SetStateAction, useCallback } from "react";
import type { NavigateToTask } from "./agent-studio-types";
import { closeTaskTab } from "./agents-page-session-tabs";

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
  clearComposerInput: () => void;
  onContextSwitchIntent: (() => void) | undefined;
  clearTaskSelection: () => void;
  navigateToTask: NavigateToTask;
  handleSelectTab: (nextTaskId: string) => void;
  setOpenTaskTabs: SetState<string[]>;
  setPersistedActiveTaskId: SetState<string | null>;
  setIntentActiveTaskId: SetState<string | null>;
};

type UseTaskTabActionsResult = {
  handleCreateTab: (nextTaskId: string) => void;
  handleCloseTab: (taskIdToClose: string) => void;
};

export function useTaskTabActions(args: UseTaskTabActionsArgs): UseTaskTabActionsResult {
  const {
    tabTaskIds,
    activeTaskTabId,
    clearComposerInput,
    onContextSwitchIntent,
    clearTaskSelection,
    navigateToTask,
    handleSelectTab,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
    setIntentActiveTaskId,
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

      clearComposerInput();
      onContextSwitchIntent?.();
      setIntentActiveTaskId(nextActiveTaskId ?? null);

      if (!nextActiveTaskId) {
        clearTaskSelection();
        return;
      }

      focusTaskTabTrigger(nextActiveTaskId);
      navigateToTask(nextActiveTaskId);
    },
    [
      activeTaskTabId,
      clearComposerInput,
      clearTaskSelection,
      navigateToTask,
      onContextSwitchIntent,
      setIntentActiveTaskId,
      setOpenTaskTabs,
      setPersistedActiveTaskId,
      tabTaskIds,
    ],
  );

  return {
    handleCreateTab,
    handleCloseTab,
  };
}
