import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import {
  DEFAULT_KANBAN_SETTINGS,
  type AgentSessionRecord,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import {
  TasksStateContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { repoTaskDataQueryOptions } from "@openducktor/frontend-core/queries/tasks";
import { useAgentSessionSummaries } from "@openducktor/frontend-core/sessions/session-store-hooks";
import {
  buildActiveTaskSessionContextByTaskId,
  buildTaskSessionsByTaskId,
} from "@openducktor/frontend-core/tasks/board/kanban-board-sessions";
import type {
  ActiveTaskSessionContext,
  KanbanTaskActivityState,
  KanbanTaskSession,
} from "@openducktor/frontend-core/tasks/board/kanban-task-activity";
import type { KanbanBoardFilterModel } from "@openducktor/frontend-core/tasks/board/use-kanban-board-filter-model";
import { useKanbanBoardColumns } from "@openducktor/frontend-core/tasks/board/use-kanban-board-columns";
import { useKanbanBoardData } from "@openducktor/frontend-core/tasks/board/use-kanban-board-data";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { type BoardColumn, buildBoardColumns } from "./board-columns";
import { resolveTaskBoardState, type TaskBoardState } from "./task-board-state";

const EMPTY_HISTORY: AgentSessionRecord[] = [];
const EMPTY_SESSIONS: KanbanTaskSession[] = [];

/** The session data of one card. Each card reads only its own entries. */
export type BoardSessionLookup = {
  sessionsOf: (taskId: string) => KanbanTaskSession[];
  historyOf: (taskId: string) => AgentSessionRecord[];
  activeContextOf: (taskId: string) => ActiveTaskSessionContext | undefined;
  activityOf: (taskId: string) => KanbanTaskActivityState;
};

export type TaskBoard = {
  state: TaskBoardState;
  /** All tasks of the workspace that the host returns, before the search and filters. */
  allTasks: TaskCard[];
  /** The tasks that the search and filters keep. */
  matchingTasks: TaskCard[];
  columns: BoardColumn[];
  filter: KanbanBoardFilterModel;
  sessions: BoardSessionLookup;
  /** The saved session history could not load. Cards then show only live sessions. */
  historyError: string | null;
  refresh: () => Promise<void>;
};

/**
 * The board of the selected workspace: the task list that the task stream keeps current, the host
 * Kanban settings, the search and filters, and the live and saved sessions of each task. It reads
 * the board data with the desktop rules.
 */
export function useTaskBoard(workspace: WorkspaceRecord): TaskBoard {
  const { refreshTasks } = useRequiredContext(TasksStateContext, "useTaskBoard");
  const board = useKanbanBoardData({
    workspaceId: workspace.workspaceId,
    repoPath: workspace.repoPath,
  });
  const { settingsQuery, filter, matchingTasks, historicalSessionsByTaskId } = board;
  const { refetch: refetchSettings } = settingsQuery;
  // Observe the task list read of the task owner without starting another read.
  const taskRead = useQuery({ ...repoTaskDataQueryOptions(workspace.repoPath), enabled: false });

  const summaries = useAgentSessionSummaries();
  const taskSessionsByTaskId = useMemo(() => buildTaskSessionsByTaskId(summaries), [summaries]);
  const activeContextByTaskId = useMemo(
    () => buildActiveTaskSessionContextByTaskId(summaries),
    [summaries],
  );
  const { columns: kanbanColumns, taskActivityStateByTaskId } = useKanbanBoardColumns(
    matchingTasks,
    taskSessionsByTaskId,
  );

  const doneVisibleDays =
    settingsQuery.data?.kanban.doneVisibleDays ?? DEFAULT_KANBAN_SETTINGS.doneVisibleDays;
  const columns = useMemo(
    () =>
      buildBoardColumns({
        columns: kanbanColumns,
        emptyColumnDisplay: board.emptyColumnDisplay,
        doneVisibleDays,
        filterActive: filter.isActive,
      }),
    [board.emptyColumnDisplay, doneVisibleDays, filter.isActive, kanbanColumns],
  );

  const sessions = useMemo<BoardSessionLookup>(
    () => ({
      sessionsOf: (taskId) => taskSessionsByTaskId.get(taskId) ?? EMPTY_SESSIONS,
      historyOf: (taskId) => historicalSessionsByTaskId.get(taskId) ?? EMPTY_HISTORY,
      activeContextOf: (taskId) => activeContextByTaskId.get(taskId),
      activityOf: (taskId) => taskActivityStateByTaskId.get(taskId) ?? "idle",
    }),
    [
      activeContextByTaskId,
      historicalSessionsByTaskId,
      taskActivityStateByTaskId,
      taskSessionsByTaskId,
    ],
  );

  const state = resolveTaskBoardState({
    settingsError: settingsQuery.error,
    taskReadError: taskRead.error,
    taskCount: board.kanbanTasks.length,
    isLoadingTasks: board.isLoadingTasks,
  });

  const refresh = useCallback(async () => {
    await Promise.all([refreshTasks(), refetchSettings()]);
  }, [refreshTasks, refetchSettings]);

  return {
    state,
    allTasks: board.kanbanTasks,
    matchingTasks,
    columns,
    filter,
    sessions,
    historyError: board.historicalSessionsError
      ? errorMessage(board.historicalSessionsError)
      : null,
    refresh,
  };
}
