import type { WorkflowBoardDefinition } from "@openducktor/contracts";
import {
  type ResolvedTaskCard as TaskCard,
  type KanbanColumn,
  mapToKanbanColumns,
} from "@openducktor/workflows";
import { useMemo } from "react";
import { buildTaskActivityStateByTaskId, sortTasksByActivityState } from "./kanban-board-sessions";
import type { KanbanTaskActivityState, KanbanTaskSession } from "./kanban-task-activity";

export type KanbanBoardColumns = {
  /** The board columns in board order. In each column, tasks that wait for input come first. */
  columns: KanbanColumn[];
  taskActivityStateByTaskId: Map<string, KanbanTaskActivityState>;
};

/** The board columns of `tasks`, with tasks that wait for input above other active tasks. */
export const buildKanbanBoardColumns = (
  tasks: TaskCard[],
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>,
  board: WorkflowBoardDefinition | undefined,
): KanbanBoardColumns => {
  const taskActivityStateByTaskId = buildTaskActivityStateByTaskId(tasks, taskSessionsByTaskId);
  const columns = (board ? mapToKanbanColumns(tasks, board) : []).map((column) => ({
    ...column,
    tasks: sortTasksByActivityState(column.tasks, taskActivityStateByTaskId),
  }));
  return { columns, taskActivityStateByTaskId };
};

/** The board columns of `tasks`. They change only when the tasks or task sessions change. */
export const useKanbanBoardColumns = (
  tasks: TaskCard[],
  taskSessionsByTaskId: Map<string, KanbanTaskSession[]>,
  board: WorkflowBoardDefinition | undefined,
): KanbanBoardColumns =>
  useMemo(
    () => buildKanbanBoardColumns(tasks, taskSessionsByTaskId, board),
    [tasks, taskSessionsByTaskId, board],
  );
