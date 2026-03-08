import type { IssueType, PlanSubtaskInput, TaskCard, TaskStatus } from "./contracts";

const canSkipSpecAndPlanning = (task: TaskCard): boolean => {
  return task.issueType === "task" || task.issueType === "bug";
};

const BASE_TRANSITION_RULES: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  open: ["spec_ready", "deferred"],
  spec_ready: ["ready_for_dev", "deferred"],
  ready_for_dev: ["in_progress", "deferred"],
  in_progress: ["blocked", "ai_review", "human_review", "deferred"],
  blocked: ["in_progress", "deferred"],
  ai_review: ["in_progress", "human_review", "deferred"],
  human_review: ["in_progress", "closed", "deferred"],
  deferred: ["open"],
  closed: [],
};

const SKIP_SPEC_AND_PLAN_TRANSITION_EXTRAS: Readonly<
  Partial<Record<TaskStatus, readonly TaskStatus[]>>
> = {
  open: ["ready_for_dev", "in_progress"],
  spec_ready: ["in_progress"],
};

const SET_SPEC_ALLOWED_STATUSES: readonly TaskStatus[] = ["open", "spec_ready", "ready_for_dev"];

const SET_PLAN_ALLOWED_STATUSES: Readonly<Record<IssueType, readonly TaskStatus[]>> = {
  epic: ["spec_ready", "ready_for_dev"],
  feature: ["spec_ready", "ready_for_dev"],
  task: ["open", "spec_ready", "ready_for_dev"],
  bug: ["open", "spec_ready", "ready_for_dev"],
};

const EPIC_SUBTASK_REPLACEMENT_ALLOWED_STATUSES: readonly TaskStatus[] = [
  "open",
  "spec_ready",
  "ready_for_dev",
];

const isStatusAllowed = (status: TaskStatus, allowed: readonly TaskStatus[]): boolean => {
  return allowed.includes(status);
};

export const getTransitionError = (
  task: TaskCard,
  allTasks: TaskCard[],
  from: TaskStatus,
  to: TaskStatus,
): string | null => {
  if (from === to) {
    return null;
  }

  const baseAllowed = BASE_TRANSITION_RULES[from] ?? [];
  const extraAllowed = canSkipSpecAndPlanning(task)
    ? (SKIP_SPEC_AND_PLAN_TRANSITION_EXTRAS[from] ?? [])
    : [];

  if (!isStatusAllowed(to, baseAllowed) && !isStatusAllowed(to, extraAllowed)) {
    return `Transition not allowed for ${task.id} (${task.issueType}): ${from} -> ${to}`;
  }

  if (to === "closed" && task.issueType === "epic") {
    const blockingSubtask = allTasks.find(
      (entry) =>
        entry.parentId === task.id && entry.status !== "closed" && entry.status !== "deferred",
    );

    if (blockingSubtask) {
      return `Epic cannot be completed while direct subtask ${blockingSubtask.id} is still active.`;
    }
  }

  return null;
};

const canSetSpecFromStatus = (status: TaskStatus): boolean => {
  return isStatusAllowed(status, SET_SPEC_ALLOWED_STATUSES);
};

const canSetPlan = (task: TaskCard): boolean => {
  return isStatusAllowed(task.status, SET_PLAN_ALLOWED_STATUSES[task.issueType] ?? []);
};

export const canReplaceEpicSubtaskStatus = (status: TaskStatus): boolean => {
  return isStatusAllowed(status, EPIC_SUBTASK_REPLACEMENT_ALLOWED_STATUSES);
};

export const getSetSpecError = (status: TaskStatus): string | null => {
  if (canSetSpecFromStatus(status)) {
    return null;
  }
  return `set_spec is only allowed from open/spec_ready/ready_for_dev (current: ${status})`;
};

export const getSetPlanError = (task: TaskCard): string | null => {
  if (canSetPlan(task)) {
    return null;
  }
  return `set_plan is not allowed for issue type ${task.issueType} from status ${task.status}`;
};

export const assertNoValidationError = (error: string | null): void => {
  if (error) {
    throw new Error(error);
  }
};

export const validatePlanSubtaskRules = (
  task: TaskCard,
  allTasks: TaskCard[],
  planSubtasks: PlanSubtaskInput[],
): void => {
  if (task.issueType !== "epic") {
    if (planSubtasks.length > 0) {
      throw new Error("Only epics can receive subtask proposals during planning.");
    }
    return;
  }

  const hasDirectSubtasks = allTasks.some((entry) => entry.parentId === task.id);
  if (!hasDirectSubtasks && planSubtasks.length === 0) {
    throw new Error("Epic plans must provide at least one direct subtask proposal.");
  }
};

export const validateTransition = (
  task: TaskCard,
  allTasks: TaskCard[],
  from: TaskStatus,
  to: TaskStatus,
): void => {
  assertNoValidationError(getTransitionError(task, allTasks, from, to));
};
