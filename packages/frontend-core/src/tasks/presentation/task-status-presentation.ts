import { BUILTIN_STATUS_LABELS, type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

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

const TASK_STATUS_TONES = {
  open: "neutral",
  spec_ready: "pending",
  ready_for_dev: "info",
  in_progress: "warning",
  blocked: "destructive",
  ai_review: "review",
  human_review: "approval",
  closed: "success",
} satisfies Record<TaskCard["status"], TaskStatusTone>;

export const statusLabel = (status: TaskCard["status"]): string => BUILTIN_STATUS_LABELS[status];

export const statusTone = (status: TaskCard["status"]): TaskStatusTone => TASK_STATUS_TONES[status];
