import type { TaskCard, TaskPhase } from "@openblueprint/contracts";

export type KanbanColumnId =
  | "backlog"
  | "specifying"
  | "ready_for_dev"
  | "in_progress"
  | "blocked_needs_input"
  | "done";

export type KanbanColumn = {
  id: KanbanColumnId;
  title: string;
  tasks: TaskCard[];
};

const columns: Array<{ id: KanbanColumnId; title: string }> = [
  { id: "backlog", title: "Backlog" },
  { id: "specifying", title: "Specifying" },
  { id: "ready_for_dev", title: "Ready for Dev" },
  { id: "in_progress", title: "In Progress" },
  { id: "blocked_needs_input", title: "Blocked / Needs Input" },
  { id: "done", title: "Done" },
];

const coercePhase = (task: TaskCard): TaskPhase => {
  if (task.phase) {
    return task.phase;
  }

  switch (task.status) {
    case "blocked":
      return "blocked_needs_input";
    case "in_progress":
      return "in_progress";
    case "closed":
      return "done";
    default:
      return "backlog";
  }
};

export const mapToKanbanColumns = (tasks: TaskCard[]): KanbanColumn[] => {
  const grouped = new Map<KanbanColumnId, TaskCard[]>();
  for (const column of columns) {
    grouped.set(column.id, []);
  }

  for (const task of tasks) {
    const phase = coercePhase(task);
    const bucket = grouped.get(phase);
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
