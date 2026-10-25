import { BUILTIN_STATUS_TITLES } from "./definition";
import type { BuiltinTaskCard } from "./task-card";
import { BUILTIN_STATE_IDS } from "./ids";

export type KanbanColumnId = BuiltinTaskCard["status"];

export type KanbanColumn = {
  id: KanbanColumnId;
  title: string;
  tasks: BuiltinTaskCard[];
};

const columns = BUILTIN_STATE_IDS.map((id) => ({ id, title: BUILTIN_STATUS_TITLES[id] }));

/** The board column title of a task status. */
export const taskStatusTitle = (status: KanbanColumnId): string => BUILTIN_STATUS_TITLES[status];

export const mapToKanbanColumns = (tasks: BuiltinTaskCard[]): KanbanColumn[] => {
  const grouped = new Map<KanbanColumnId, BuiltinTaskCard[]>();
  for (const column of columns) {
    grouped.set(column.id, []);
  }

  for (const task of tasks) {
    const column = task.status;
    const bucket = grouped.get(column);
    if (bucket) {
      bucket.push(task);
    }
  }

  return columns.map((column) => ({
    id: column.id,
    title: column.title,
    tasks: grouped.get(column.id) ?? [],
  }));
};
