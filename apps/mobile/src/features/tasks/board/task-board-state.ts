import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { summarizeTaskLoadError } from "@openducktor/frontend-core/tasks/task-load-errors";

export type TaskBoardState =
  | { status: "loading" }
  | { status: "error"; title: string; message: string }
  | { status: "ready" };

export type TaskBoardReads = {
  /** The error of the Kanban settings read, or null. */
  settingsError: unknown;
  /** The error of the task list read of the task owner, or null. */
  taskReadError: unknown;
  /** The tasks of the board, before the search and filters. */
  taskCount: number;
  /** True during a foreground task read or the first settings read, as `isKanbanForegroundLoading` tells. */
  isLoadingTasks: boolean;
};

/**
 * What the board shows: the loading state, a read failure, or the lanes. As on desktop, a failed
 * settings read hides the tasks, and the loading state shows only while the board has no task.
 */
export function resolveTaskBoardState({
  settingsError,
  taskReadError,
  taskCount,
  isLoadingTasks,
}: TaskBoardReads): TaskBoardState {
  if (settingsError != null) {
    return {
      status: "error",
      title: "Kanban settings could not load",
      message: errorMessage(settingsError),
    };
  }
  if (taskReadError != null && taskCount === 0) {
    return {
      status: "error",
      title: "Tasks could not load",
      message: summarizeTaskLoadError({ error: taskReadError }),
    };
  }
  if (isLoadingTasks && taskCount === 0) return { status: "loading" };
  return { status: "ready" };
}

/** What the Tasks tab shows in place of its lanes, or `board`. */
export type TaskBoardView =
  | { kind: "host_unavailable" }
  | { kind: "loading" }
  | { kind: "error"; title: string; message: string }
  | { kind: "no_tasks" }
  | { kind: "no_results" }
  | { kind: "no_lanes" }
  | { kind: "board" };

export const taskBoardView = ({
  state,
  hostUnavailable,
  taskCount,
  filterActive,
  matchingCount,
  columnCount,
}: {
  state: TaskBoardState;
  hostUnavailable: boolean;
  taskCount: number;
  filterActive: boolean;
  matchingCount: number;
  columnCount: number;
}): TaskBoardView => {
  if (hostUnavailable && state.status !== "ready") return { kind: "host_unavailable" };
  if (state.status === "loading") return { kind: "loading" };
  if (state.status === "error")
    return { kind: "error", title: state.title, message: state.message };
  if (taskCount === 0) return { kind: "no_tasks" };
  // As on desktop, an active search or filter that keeps no task says so, also when the board
  // shows empty lanes.
  if (filterActive && matchingCount === 0) return { kind: "no_results" };
  // The board hides empty lanes, and no lane can have a task to show.
  return columnCount === 0 ? { kind: "no_lanes" } : { kind: "board" };
};
