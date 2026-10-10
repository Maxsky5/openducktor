import type { TaskDetailsConfirm } from "@/components/features/task-details/task-details-sheet-types";

export const KANBAN_PATH = "/kanban";

/** Query keys that open the task details sheet on the Kanban page. */
export const KANBAN_TASK_QUERY_KEYS = {
  task: "task",
  confirm: "taskConfirm",
} as const;

export const parseTaskDetailsConfirm = (value: string | null): TaskDetailsConfirm | null =>
  value === "reset_task" || value === "delete" ? value : null;

/** The Kanban page with the details sheet of a task, and optionally one of its confirmations. */
export const buildKanbanTaskHref = (taskId: string, confirm?: TaskDetailsConfirm): string => {
  const params = new URLSearchParams();
  params.set(KANBAN_TASK_QUERY_KEYS.task, taskId);
  if (confirm) params.set(KANBAN_TASK_QUERY_KEYS.confirm, confirm);
  return `${KANBAN_PATH}?${params.toString()}`;
};
