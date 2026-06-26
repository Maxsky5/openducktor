import type { TaskAction, TaskCard } from "@openducktor/contracts";
import {
  allowsTransition,
  canManuallyCloseTask,
  canResetImplementationFromStatus,
  canResetTaskFromStatus,
  canSetPlan,
  canSetSpecFromStatus,
  canTransitionToClosed,
  canUseQaWorkflowFromStatus,
  isActiveOrReviewStatus,
} from "./status-transition-policy";

const isQaRejectedRework = (task: TaskCard): boolean =>
  (task.status === "in_progress" || task.status === "blocked") &&
  task.documentSummary.qaReport.verdict === "rejected";

export const deriveAvailableActions = (task: TaskCard, allTasks: TaskCard[]): TaskAction[] => {
  const actions: TaskAction[] = ["view_details"];

  if (canSetSpecFromStatus(task.status)) {
    actions.push("set_spec");
  }

  if (canSetPlan(task)) {
    actions.push("set_plan");
  }

  if (canUseQaWorkflowFromStatus(task.status)) {
    actions.push("qa_start");
  }

  const canStartBuild =
    isQaRejectedRework(task) ||
    (!isActiveOrReviewStatus(task.status) && allowsTransition(task, task.status, "in_progress"));
  if (canStartBuild) {
    actions.push("build_start");
  }

  if (isActiveOrReviewStatus(task.status)) {
    actions.push("open_builder");
  }

  if (canResetImplementationFromStatus(task.status)) {
    actions.push("reset_implementation");
  }

  if (canResetTaskFromStatus(task.status)) {
    actions.push("reset_task");
  }

  if (isQaRejectedRework(task)) {
    actions.push("open_qa");
  }

  if (task.status === "ai_review" || task.status === "human_review") {
    actions.push("human_request_changes");
  }

  if (
    (task.status === "ai_review" || task.status === "human_review") &&
    canTransitionToClosed(task, allTasks)
  ) {
    actions.push("human_approve");
  }

  if (canManuallyCloseTask(task, allTasks)) {
    actions.push("close_task");
  }

  return actions;
};
