import type { SharedBoardState, WorkflowBoardDefinition } from "@openducktor/contracts";
import { compareBoardTasks, type ResolvedTaskCard } from "./task-workflow-view";

export type KanbanColumnId = string;

/** A board column with its tasks in the column task order. */
export type KanbanColumn = SharedBoardState & { tasks: ResolvedTaskCard[] };

/** Groups resolved tasks into every board column, empty columns included, in board order. */
export const mapToKanbanColumns = (
  tasks: readonly ResolvedTaskCard[],
  board: WorkflowBoardDefinition,
): KanbanColumn[] => {
  const grouped = new Map<KanbanColumnId, ResolvedTaskCard[]>(
    board.states.map((column) => [column.id, []]),
  );
  for (const task of tasks) {
    const bucket = grouped.get(task.status);
    if (!bucket)
      throw new Error(
        `Task "${task.id}" uses missing board state "${task.status}". Fix the host board.`,
      );
    bucket.push(task);
  }
  return board.states.map((column) => ({
    ...column,
    tasks: grouped
      .get(column.id)!
      .sort((left, right) => compareBoardTasks(left, right, column.taskOrder)),
  }));
};
