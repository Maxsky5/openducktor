export const KANBAN_PATH = "/kanban";

/** Query keys that open the task details sheet on the Kanban page. */
export const KANBAN_TASK_QUERY_KEYS = {
  task: "task",
} as const;

/** The Kanban page with the details sheet of a task. */
export const buildKanbanTaskHref = (taskId: string): string => {
  const params = new URLSearchParams();
  params.set(KANBAN_TASK_QUERY_KEYS.task, taskId);
  return `${KANBAN_PATH}?${params.toString()}`;
};
