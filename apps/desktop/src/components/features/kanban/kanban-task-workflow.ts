import type { TaskAction, TaskCard } from "@openblueprint/contracts";

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

  const priority =
    ACTION_PRIORITY_BY_ISSUE_TYPE[task.issueType] ?? ACTION_PRIORITY_BY_ISSUE_TYPE.task;
  const primaryAction = priority.find((action) => enabled.includes(action)) ?? enabled[0] ?? null;

  return {
    primaryAction,
    secondaryActions: primaryAction
      ? enabled.filter((action) => action !== primaryAction)
      : enabled,
    allActions: enabled,
  };
};
