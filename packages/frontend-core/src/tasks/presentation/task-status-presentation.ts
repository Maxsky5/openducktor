import type { TaskCard } from "@openducktor/contracts";

/**
 * The color family of a task status. `review` and `approval` have no semantic theme token, so
 * each client picks its own color for them. A label always goes with the color.
 */
export type TaskStatusTone =
  | "neutral"
  | "pending"
  | "info"
  | "warning"
  | "destructive"
  | "review"
  | "approval"
  | "success";

const TASK_STATUS_PRESENTATION = {
  open: { label: "Backlog", tone: "neutral" },
  spec_ready: { label: "Spec ready", tone: "pending" },
  ready_for_dev: { label: "Ready for dev", tone: "info" },
  in_progress: { label: "In progress", tone: "warning" },
  blocked: { label: "Blocked needs input", tone: "destructive" },
  ai_review: { label: "AI review", tone: "review" },
  human_review: { label: "Human review", tone: "approval" },
  closed: { label: "Done", tone: "success" },
} satisfies Record<TaskCard["status"], { label: string; tone: TaskStatusTone }>;

export const statusLabel = (status: TaskCard["status"]): string =>
  TASK_STATUS_PRESENTATION[status].label;

export const statusTone = (status: TaskCard["status"]): TaskStatusTone =>
  TASK_STATUS_PRESENTATION[status].tone;
