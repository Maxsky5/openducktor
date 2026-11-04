import { actionEmphasis } from "@openducktor/workflows";
import type { TaskWorkflowAction, ResolvedTaskCard } from "@openducktor/workflows";
import type { KanbanTaskSession } from "./kanban-task-activity";

/**
 * How a client weights an action control: `prominent` actions move the task forward, `destructive`
 * actions discard work, and `warning` actions override the workflow.
 */
export type TaskActionTone = "prominent" | "neutral" | "destructive" | "warning";

export const taskActionTone = (
  action: TaskWorkflowAction,
  task: ResolvedTaskCard,
): TaskActionTone => actionEmphasis(task.taskWorkflow.action(action));
export const taskActionIsDestructive = (
  action: TaskWorkflowAction,
  task: ResolvedTaskCard,
): boolean => taskActionTone(action, task) === "destructive";

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
