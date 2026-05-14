import type { TaskCard, TaskStatus } from "@openducktor/contracts";

export const canSkipSpecAndPlanning = (task: TaskCard): boolean =>
  task.issueType === "task" || task.issueType === "bug";

export const isOpenState = (status: TaskStatus): boolean =>
  status !== "closed" && status !== "deferred";

export const isDeferrableOpenState = isOpenState;

export const isActiveOrReviewStatus = (status: TaskStatus): boolean =>
  status === "in_progress" ||
  status === "blocked" ||
  status === "ai_review" ||
  status === "human_review";

export const isReadyForDevOrLater = (status: TaskStatus): boolean =>
  status === "ready_for_dev" ||
  status === "in_progress" ||
  status === "blocked" ||
  status === "ai_review" ||
  status === "human_review";

export const canSetSpecFromStatus = (status: TaskStatus): boolean =>
  status === "open" ||
  status === "spec_ready" ||
  status === "ready_for_dev" ||
  status === "in_progress" ||
  status === "blocked" ||
  status === "ai_review" ||
  status === "human_review";

export const canSetPlan = (task: TaskCard): boolean => {
  if (task.issueType === "epic" || task.issueType === "feature") {
    return (
      task.status === "spec_ready" ||
      task.status === "ready_for_dev" ||
      isActiveOrReviewStatus(task.status)
    );
  }

  return (
    task.status === "open" ||
    task.status === "spec_ready" ||
    task.status === "ready_for_dev" ||
    isActiveOrReviewStatus(task.status)
  );
};

export const canReplaceEpicSubtaskStatus = (status: TaskStatus): boolean =>
  status === "open" || status === "spec_ready" || status === "ready_for_dev";

export const canResetImplementationFromStatus = (status: TaskStatus): boolean =>
  status === "in_progress" ||
  status === "blocked" ||
  status === "ai_review" ||
  status === "human_review";

export const canResetTaskFromStatus = (status: TaskStatus): boolean =>
  status !== "deferred" && status !== "closed";

export const allowsTransition = (task: TaskCard, from: TaskStatus, to: TaskStatus): boolean => {
  if (from === to) {
    return true;
  }

  if (from === "open") {
    if (canSkipSpecAndPlanning(task)) {
      return (
        to === "spec_ready" || to === "ready_for_dev" || to === "in_progress" || to === "deferred"
      );
    }

    return to === "spec_ready" || to === "deferred";
  }

  if (from === "spec_ready") {
    if (canSkipSpecAndPlanning(task)) {
      return to === "ready_for_dev" || to === "in_progress" || to === "deferred";
    }

    return to === "ready_for_dev" || to === "deferred";
  }

  if (from === "ready_for_dev") {
    return to === "in_progress" || to === "deferred";
  }

  if (from === "in_progress") {
    return to === "blocked" || to === "ai_review" || to === "human_review" || to === "deferred";
  }

  if (from === "blocked") {
    return to === "in_progress" || to === "ai_review" || to === "human_review" || to === "deferred";
  }

  if (from === "ai_review") {
    return to === "in_progress" || to === "human_review" || to === "closed" || to === "deferred";
  }

  if (from === "human_review") {
    return to === "in_progress" || to === "closed" || to === "deferred";
  }

  if (from === "deferred") {
    return to === "open";
  }

  return false;
};

const canCloseEpic = (task: TaskCard, allTasks: TaskCard[]): boolean => {
  if (task.issueType !== "epic") {
    return true;
  }

  return !allTasks.some(
    (candidate) =>
      candidate.parentId === task.id &&
      candidate.status !== "closed" &&
      candidate.status !== "deferred",
  );
};

export const canTransitionToClosed = (task: TaskCard, allTasks: TaskCard[]): boolean =>
  allowsTransition(task, task.status, "closed") && canCloseEpic(task, allTasks);

export const validateTransition = (
  task: TaskCard,
  allTasks: TaskCard[],
  from: TaskStatus,
  to: TaskStatus,
): void => {
  if (!allowsTransition(task, from, to)) {
    throw new Error(`Transition not allowed for ${task.id} (${task.issueType}): ${from} -> ${to}`);
  }

  if (to !== "closed" || task.issueType !== "epic") {
    return;
  }

  const blockingSubtask = allTasks.find(
    (candidate) =>
      candidate.parentId === task.id &&
      candidate.status !== "closed" &&
      candidate.status !== "deferred",
  );
  if (blockingSubtask) {
    throw new Error(
      `Epic cannot be completed while direct subtask ${blockingSubtask.id} is still active.`,
    );
  }
};

export const ensurePullRequestManagementStatus = (status: TaskCard["status"]): void => {
  if (status === "in_progress" || status === "ai_review" || status === "human_review") {
    return;
  }

  throw new Error(
    "Pull request management is only available from in_progress, ai_review, or human_review.",
  );
};

export const ensureHumanApprovalStatus = (status: TaskCard["status"]): void => {
  if (status === "ai_review" || status === "human_review") {
    return;
  }

  throw new Error("Human approval is only allowed from ai_review or human_review.");
};
