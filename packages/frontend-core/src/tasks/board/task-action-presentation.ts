import type { TaskCard } from "@openducktor/contracts";
import { isQaRejectedTask } from "../../lib/task-qa";
import type { KanbanTaskSession } from "./kanban-task-activity";
import type { TaskWorkflowAction } from "./kanban-task-workflow";

type TaskActionLabelOptions = {
  surface?: "kanban" | "agent_studio";
};

/** The label of a task workflow action. Every client shows the same label. */
export const taskActionLabel = (
  action: TaskWorkflowAction,
  task: TaskCard,
  options: TaskActionLabelOptions = {},
): string => {
  if (action === "set_spec") {
    return task.status === "spec_ready" ? "Open Spec" : "Start Spec";
  }
  if (action === "set_plan") {
    return "Start Planner";
  }
  if (action === "open_spec") {
    return "Open Spec";
  }
  if (action === "open_planner") {
    return "Open Planner";
  }
  if (action === "open_builder") {
    return "Open Builder";
  }
  if (action === "open_qa") {
    return "Open QA";
  }
  if (action === "reset_implementation") {
    return "Reset Implementation";
  }
  if (action === "reset_task") {
    return "Reset Task";
  }
  if (action === "close_task") {
    return "Close Task";
  }
  if (action === "build_start") {
    if (isQaRejectedTask(task)) {
      return "Address QA Feedbacks";
    }
    return options.surface === "agent_studio" ? "Start Implementation" : "Start Builder";
  }
  if (action === "qa_start") {
    return "Request QA Review";
  }
  if (action === "human_approve") {
    return "Approve Task";
  }
  if (action === "human_request_changes") {
    return "Request Changes";
  }
  const exhaustive: never = action;
  return exhaustive;
};

/**
 * How a client weights an action control: `prominent` actions move the task forward, `destructive`
 * actions discard work, and `warning` actions override the workflow.
 */
export type TaskActionTone = "prominent" | "neutral" | "destructive" | "warning";

export const taskActionIsDestructive = (action: TaskWorkflowAction): boolean =>
  action === "reset_implementation" || action === "reset_task";

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
