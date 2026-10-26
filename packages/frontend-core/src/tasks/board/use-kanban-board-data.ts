import {
  type AgentSessionRecord,
  DEFAULT_KANBAN_SETTINGS,
  type TaskCard,
} from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { TasksStateContext, useRequiredContext } from "../../app-state/app-state-contexts";
import { useAgentSessionLists } from "../../queries/use-agent-session-lists";
import { settingsSnapshotQueryOptions } from "../../queries/workspace";
import { isKanbanForegroundLoading } from "./kanban-board-loading";
import { useKanbanBoardFilterModel } from "./use-kanban-board-filter-model";

const NO_TASKS: TaskCard[] = [];
const NO_SESSIONS: AgentSessionRecord[] = [];

/**
 * The data of the Kanban board of the selected workspace: the host settings, the tasks, the
 * search and filters, and the saved sessions of each task. A failed settings read hides the
 * tasks, because the board cannot apply the Kanban settings without it.
 */
export function useKanbanBoardData({
  workspaceId,
  repoPath,
}: {
  workspaceId: string | null;
  repoPath: string | null;
}) {
  const queryClient = useQueryClient();
  const { tasks, isForegroundLoadingTasks } = useRequiredContext(
    TasksStateContext,
    "useKanbanBoardData",
  );
  const settingsQuery = useQuery(settingsSnapshotQueryOptions());
  const kanbanTasks = repoPath && !settingsQuery.isError ? tasks : NO_TASKS;
  const taskIds = useMemo(() => kanbanTasks.map((task) => task.id), [kanbanTasks]);
  const { filter, matchingTasks } = useKanbanBoardFilterModel(workspaceId, kanbanTasks);
  const sessionLists = useAgentSessionLists({
    repoPath,
    taskIds,
    enabled: repoPath !== null && taskIds.length > 0,
    queryClient,
  });
  const historicalSessionsByTaskId = useMemo(
    () => new Map(taskIds.map((taskId) => [taskId, sessionLists.data[taskId] ?? NO_SESSIONS])),
    [sessionLists.data, taskIds],
  );
  const isLoadingTasks = isKanbanForegroundLoading({
    hasActiveWorkspace: repoPath !== null,
    isForegroundLoadingTasks,
    isSettingsPending: settingsQuery.isPending,
    doneVisibleDays: settingsQuery.data?.kanban.doneVisibleDays,
    isKanbanPending: false,
  });
  return {
    settingsQuery,
    emptyColumnDisplay:
      settingsQuery.data?.kanban.emptyColumnDisplay ?? DEFAULT_KANBAN_SETTINGS.emptyColumnDisplay,
    /** The tasks of the board before the search and filters. */
    kanbanTasks,
    filter,
    /** The tasks that the search and filters keep. */
    matchingTasks,
    historicalSessionsByTaskId,
    historicalSessionsError: sessionLists.error,
    isLoadingTasks,
  };
}
