import type { TaskAction, TaskCard } from "@openducktor/contracts";

export type TaskWorkflowAction = Exclude<TaskAction, "view_details">;

export type TaskCardActionState = {
  primaryAction: TaskWorkflowAction | null;
  secondaryActions: TaskWorkflowAction[];
  allActions: TaskWorkflowAction[];
};

type ResolveTaskCardActionsOptions = {
  include?: readonly TaskWorkflowAction[];
};

const ACTION_PRIORITY_BY_ISSUE_TYPE: Record<TaskCard["issueType"], TaskWorkflowAction[]> = {
  epic: [
    "set_spec",
    "set_plan",
    "build_start",
    "open_builder",
    "human_approve",
    "human_request_changes",
    "resume_deferred",
    "defer_issue",
  ],
  feature: [
    "set_spec",
    "set_plan",
    "build_start",
    "open_builder",
    "human_approve",
    "human_request_changes",
    "resume_deferred",
    "defer_issue",
  ],
  bug: [
    "build_start",
    "set_plan",
    "set_spec",
    "open_builder",
    "human_approve",
    "human_request_changes",
    "resume_deferred",
    "defer_issue",
  ],
  task: [
    "build_start",
    "set_plan",
    "set_spec",
    "open_builder",
    "human_approve",
    "human_request_changes",
    "resume_deferred",
    "defer_issue",
  ],
};

const isWorkflowAction = (action: TaskAction): action is TaskWorkflowAction =>
  action !== "view_details";

const dedupeActions = (actions: TaskWorkflowAction[]): TaskWorkflowAction[] =>
  Array.from(new Set(actions));

const prioritize = (
  actionPriority: readonly TaskWorkflowAction[],
  prioritizeAhead: readonly TaskWorkflowAction[],
): TaskWorkflowAction[] => {
  const uniqueAhead = dedupeActions(Array.from(prioritizeAhead));
  const seen = new Set(uniqueAhead);
  return [...uniqueAhead, ...actionPriority.filter((action) => !seen.has(action))];
};

const resolvePriorityForTask = (task: TaskCard): TaskWorkflowAction[] => {
  const basePriority =
    ACTION_PRIORITY_BY_ISSUE_TYPE[task.issueType] ?? ACTION_PRIORITY_BY_ISSUE_TYPE.task;

  switch (task.status) {
    case "spec_ready": {
      return prioritize(basePriority, ["set_plan", "set_spec"]);
    }
    case "ready_for_dev": {
      return prioritize(basePriority, ["build_start"]);
    }
    case "deferred": {
      return prioritize(basePriority, ["resume_deferred"]);
    }
    case "in_progress":
    case "blocked":
    case "ai_review": {
      return prioritize(basePriority, ["open_builder", "build_start"]);
    }
    case "human_review": {
      return prioritize(basePriority, [
        "human_approve",
        "human_request_changes",
        "open_builder",
        "build_start",
      ]);
    }
    default: {
      return basePriority;
    }
  }
};

export const resolveTaskCardActions = (
  task: TaskCard,
  options: ResolveTaskCardActionsOptions = {},
): TaskCardActionState => {
  const includeSet = options.include ? new Set(options.include) : null;
  const enabled = dedupeActions(
    task.availableActions
      .filter(isWorkflowAction)
      .filter((action) => (includeSet ? includeSet.has(action) : true)),
  );

  const priority = resolvePriorityForTask(task);
  const primaryAction = priority.find((action) => enabled.includes(action)) ?? enabled[0] ?? null;

  return {
    primaryAction,
    secondaryActions: primaryAction
      ? enabled.filter((action) => action !== primaryAction)
      : enabled,
    allActions: enabled,
  };
};
