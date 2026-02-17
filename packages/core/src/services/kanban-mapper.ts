import type { TaskCard, TaskStatus } from "@openblueprint/contracts";

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

const columns: Array<{ id: KanbanColumnId; title: string }> = [
  { id: "open", title: "Backlog" },
  { id: "spec_ready", title: "Spec Ready" },
  { id: "ready_for_dev", title: "Ready for Dev" },
  { id: "in_progress", title: "In Progress" },
  { id: "blocked", title: "Blocked / Needs Input" },
  { id: "ai_review", title: "AI Review" },
  { id: "human_review", title: "Human Review" },
  { id: "closed", title: "Done" },
];

const toColumn = (status: TaskStatus): KanbanColumnId | null =>
  status === "deferred" ? null : status;

export const mapToKanbanColumns = (tasks: TaskCard[]): KanbanColumn[] => {
  const grouped = new Map<KanbanColumnId, TaskCard[]>();
  for (const column of columns) {
    grouped.set(column.id, []);
  }

  for (const task of tasks) {
    const column = toColumn(task.status);
    if (!column) {
      continue;
    }
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
