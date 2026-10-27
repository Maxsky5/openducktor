import type { TaskWorkflowAction } from "@openducktor/workflows";
import type { KanbanTaskSession } from "./kanban-task-activity";

/**
 * How a client weights an action control: `prominent` actions move the task forward, `destructive`
 * actions discard work, and `warning` actions override the workflow.
 */
export type TaskActionTone = "prominent" | "neutral" | "destructive" | "warning";

export const taskActionIsDestructive = (action: TaskWorkflowAction): boolean =>
  action === "reset_implementation" || action === "reset_task" || action === "remove_worktree";

export const taskActionIsWarning = (action: TaskWorkflowAction): boolean => action === "close_task";

export const taskActionTone = (action: TaskWorkflowAction): TaskActionTone => {
  if (action === "build_start" || action === "qa_start" || action === "human_approve") {
    return "prominent";
  }
  if (taskActionIsDestructive(action)) {
    return "destructive";
  }
  if (taskActionIsWarning(action)) {
    return "warning";
  }
  return "neutral";
};

/** The state of the active session that a task card shows on its primary control. */
export const taskSessionStatusLabel = ({
  session,
  isWaitingInput,
}: {
  session: Pick<KanbanTaskSession, "activityState" | "statusUnavailableReason">;
  isWaitingInput: boolean;
}): string => {
  if (isWaitingInput) {
    return "Waiting input";
  }

  if (session.statusUnavailableReason) {
    return "Status unavailable";
  }

  if (session.activityState === "starting") {
    return "Starting";
  }

  return "Running";
};
