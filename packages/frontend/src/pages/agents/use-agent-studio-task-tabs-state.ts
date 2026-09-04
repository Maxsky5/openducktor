import type { TaskCard, WorkspaceAgentStudioState } from "@openducktor/contracts";
import { useCallback, useMemo, useReducer } from "react";
import { ensureActiveTaskTab } from "./agent-studio-task-tabs-list";
import { reconcileAgentStudioOpenTaskIds } from "./agent-studio-workspace-state";

export type TaskTabStateUpdate = {
  openTaskIds: string[];
  activeTaskId: string | null;
};

type TaskTabDraft = TaskTabStateUpdate & {
  workspaceId: string;
  sourceVersion: string;
};

type ReplaceTaskTabDraft = {
  type: "replace";
  draft: TaskTabDraft;
};

const replaceTaskTabDraft = (
  _current: TaskTabDraft | null,
  action: ReplaceTaskTabDraft,
): TaskTabDraft => action.draft;

export function useTaskTabState({
  activeWorkspaceId,
  loadedAgentStudioState,
  loadedAgentStudioStateVersion,
  agentStudioState,
  taskId,
  selectedTask,
  tasks,
  isLoadingTasks,
}: {
  activeWorkspaceId: string | null;
  loadedAgentStudioState: WorkspaceAgentStudioState | null;
  loadedAgentStudioStateVersion: string | null;
  agentStudioState: WorkspaceAgentStudioState | null;
  taskId: string;
  selectedTask: TaskCard | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
}) {
  const [draft, dispatch] = useReducer(replaceTaskTabDraft, null);
  const sourceMatchesDraft = Boolean(
    activeWorkspaceId &&
    loadedAgentStudioState &&
    loadedAgentStudioStateVersion !== null &&
    draft?.workspaceId === activeWorkspaceId &&
    draft.sourceVersion === loadedAgentStudioStateVersion,
  );
  const isWorkspaceStateReady = Boolean(
    activeWorkspaceId &&
    loadedAgentStudioState &&
    loadedAgentStudioStateVersion !== null &&
    agentStudioState,
  );

  const state = useMemo<TaskTabStateUpdate>(() => {
    if (!isWorkspaceStateReady || !agentStudioState) {
      return { openTaskIds: [], activeTaskId: null };
    }

    const sourceOpenTaskIds =
      sourceMatchesDraft && draft ? draft.openTaskIds : agentStudioState.openTaskIds;
    const sourceActiveTaskId =
      sourceMatchesDraft && draft
        ? draft.activeTaskId
        : (agentStudioState.activeTask?.taskId ?? null);
    const reconciledTaskIds = isLoadingTasks
      ? sourceOpenTaskIds
      : reconcileAgentStudioOpenTaskIds(sourceOpenTaskIds, tasks);
    const hasValidRouteTask = Boolean(taskId && selectedTask && selectedTask.status !== "closed");
    const openTaskIds = hasValidRouteTask
      ? ensureActiveTaskTab(reconciledTaskIds, taskId)
      : reconciledTaskIds;

    return {
      openTaskIds,
      activeTaskId: sourceActiveTaskId,
    };
  }, [
    agentStudioState,
    draft,
    isLoadingTasks,
    isWorkspaceStateReady,
    selectedTask,
    sourceMatchesDraft,
    taskId,
    tasks,
  ]);

  const updateState = useCallback(
    (nextState: TaskTabStateUpdate): void => {
      if (!activeWorkspaceId || !loadedAgentStudioState || loadedAgentStudioStateVersion === null) {
        return;
      }
      dispatch({
        type: "replace",
        draft: {
          workspaceId: activeWorkspaceId,
          sourceVersion: loadedAgentStudioStateVersion,
          ...nextState,
        },
      });
    },
    [activeWorkspaceId, loadedAgentStudioState, loadedAgentStudioStateVersion],
  );

  return {
    openTaskIds: state.openTaskIds,
    persistedActiveTaskId: state.activeTaskId,
    loadedStateWorkspaceId: isWorkspaceStateReady ? activeWorkspaceId : null,
    updateState,
  };
}
