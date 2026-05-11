import type {
  AgentWorkflows,
  QaWorkflowVerdict,
  TaskAction,
  TaskCard,
  TaskStatus,
} from "@openducktor/contracts";

const canSkipSpecAndPlanning = (task: TaskCard): boolean =>
  task.issueType === "task" || task.issueType === "bug";

const isOpenState = (status: TaskStatus): boolean => status !== "closed" && status !== "deferred";

export const isDeferrableOpenState = isOpenState;

export const isActiveOrReviewStatus = (status: TaskStatus): boolean =>
  status === "in_progress" ||
  status === "blocked" ||
  status === "ai_review" ||
  status === "human_review";

const isReadyForDevOrLater = (status: TaskStatus): boolean =>
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

const isQaRejectedRework = (task: TaskCard): boolean =>
  (task.status === "in_progress" || task.status === "blocked") &&
  task.documentSummary.qaReport.verdict === "rejected";

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

const canTransitionToClosed = (task: TaskCard, allTasks: TaskCard[]): boolean =>
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

export const deriveAgentWorkflows = (task: TaskCard): AgentWorkflows => {
  const isFeatureEpic = task.issueType === "feature" || task.issueType === "epic";
  const isTaskBug = task.issueType === "task" || task.issueType === "bug";
  const isClosed = task.status === "closed";
  const readyForDevOrLater = isReadyForDevOrLater(task.status);
  const plannerFeatureEpicStatus = task.status === "spec_ready" || readyForDevOrLater;
  const qaVerdict: QaWorkflowVerdict = task.documentSummary.qaReport.verdict;

  return {
    spec: {
      required: isFeatureEpic,
      canSkip: !isFeatureEpic,
      available: !isClosed,
      completed: task.documentSummary.spec.has,
    },
    planner: {
      required: isFeatureEpic,
      canSkip: !isFeatureEpic,
      available: !isClosed && (isTaskBug || (isFeatureEpic && plannerFeatureEpicStatus)),
      completed: task.documentSummary.plan.has,
    },
    builder: {
      required: true,
      canSkip: false,
      available: !isClosed && (isTaskBug || (isFeatureEpic && readyForDevOrLater)),
      completed:
        task.status === "ai_review" || task.status === "human_review" || task.status === "closed",
    },
    qa: {
      required: task.aiReviewEnabled,
      canSkip: !task.aiReviewEnabled,
      available: !isClosed && (task.status === "ai_review" || task.status === "human_review"),
      completed: qaVerdict === "approved",
    },
  };
};

export const deriveAvailableActions = (task: TaskCard, allTasks: TaskCard[]): TaskAction[] => {
  const actions: TaskAction[] = ["view_details"];

  if (canSetSpecFromStatus(task.status)) {
    actions.push("set_spec");
  }

  if (canSetPlan(task)) {
    actions.push("set_plan");
  }

  if (task.status === "ai_review" || task.status === "human_review") {
    actions.push("qa_start");
  } else {
    const canStartBuild =
      isQaRejectedRework(task) ||
      (task.status !== "in_progress" &&
        task.status !== "blocked" &&
        allowsTransition(task, task.status, "in_progress"));
    if (canStartBuild) {
      actions.push("build_start");
    }
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

  if (task.parentId === undefined) {
    if (task.status === "deferred") {
      actions.push("resume_deferred");
    } else if (isOpenState(task.status)) {
      actions.push("defer_issue");
    }
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

  return actions;
};
