import type { TaskCard } from "@openducktor/contracts";

export type KanbanColumnId =
  | "open"
  | "spec_ready"
  | "ready_for_dev"
  | "in_progress"
  | "blocked"
  | "ai_review"
  | "human_review"
  | "closed";

export type KanbanColumn = {
  id: KanbanColumnId;
  title: string;
  tasks: TaskCard[];
};

const columnTitles = {
  open: "Backlog",
  spec_ready: "Spec Ready",
  ready_for_dev: "Ready for Dev",
  in_progress: "In Progress",
  blocked: "Blocked / Needs Input",
  ai_review: "AI Review",
  human_review: "Human Review",
  closed: "Done",
} satisfies Record<KanbanColumnId, string>;

const columnOrder: KanbanColumnId[] = [
  "open",
  "spec_ready",
  "ready_for_dev",
  "in_progress",
  "blocked",
  "ai_review",
  "human_review",
  "closed",
];

const columns = columnOrder.map((id) => ({ id, title: columnTitles[id] }));

/** The board column title of a task status. */
export const taskStatusTitle = (status: KanbanColumnId): string => columnTitles[status];

export const mapToKanbanColumns = (tasks: TaskCard[]): KanbanColumn[] => {
  const grouped = new Map<KanbanColumnId, TaskCard[]>();
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
