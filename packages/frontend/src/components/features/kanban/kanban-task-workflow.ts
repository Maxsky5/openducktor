import type { TaskAction, TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { isQaRejectedTask } from "@/lib/task-qa";

type SessionRoleViewAction = "open_spec" | "open_planner" | "open_builder" | "open_qa";

type BaseTaskWorkflowAction = Exclude<TaskAction, "view_details">;

export type TaskWorkflowAction = BaseTaskWorkflowAction | "open_spec" | "open_planner";

type TaskCardActionState = {
  primaryAction: TaskWorkflowAction | null;
  secondaryActions: TaskWorkflowAction[];
  allActions: TaskWorkflowAction[];
};

type ResolveTaskCardActionsOptions = {
  include?: readonly TaskWorkflowAction[];
  hasActiveSession?: boolean;
  activeSessionRole?: AgentRole;
  historicalSessionRoles?: readonly AgentRole[];
};

const SESSION_CREATING_ACTIONS: readonly TaskWorkflowAction[] = [
  "set_spec",
  "set_plan",
  "build_start",
  "qa_start",
];

const SESSION_VIEW_ACTION_BY_ROLE: Record<AgentRole, SessionRoleViewAction> = {
  spec: "open_spec",
  planner: "open_planner",
  build: "open_builder",
  qa: "open_qa",
};

const SESSION_VIEW_ACTIONS = new Set<SessionRoleViewAction>(
  Object.values(SESSION_VIEW_ACTION_BY_ROLE),
);

const toRoleSessionViewAction = (role: AgentRole): SessionRoleViewAction =>
  SESSION_VIEW_ACTION_BY_ROLE[role];

const filterEnabledActions = (
  task: TaskCard,
  options: ResolveTaskCardActionsOptions,
): TaskWorkflowAction[] => {
  const includeSet = options.include ? new Set(options.include) : null;
  let enabled: TaskWorkflowAction[] = dedupeActions(
    task.availableActions
      .filter(isWorkflowAction)
      .filter((action) => (includeSet ? includeSet.has(action) : true)),
  );

  if (options.hasActiveSession) {
    enabled = enabled.filter((action) => !SESSION_CREATING_ACTIONS.includes(action));
  }

  const historicalSessionViewActions: TaskWorkflowAction[] = dedupeActions(
    (options.historicalSessionRoles ?? []).map(toRoleSessionViewAction),
  ).filter((action) => (includeSet ? includeSet.has(action) : true));

  enabled = dedupeActions([...enabled, ...historicalSessionViewActions]);

  if (options.hasActiveSession && options.activeSessionRole) {
    const activeSessionViewAction = toRoleSessionViewAction(options.activeSessionRole);
    if (!includeSet || includeSet.has(activeSessionViewAction)) {
      enabled = dedupeActions([activeSessionViewAction, ...enabled]);
    }
  }

  if (task.status === "human_review") {
    return enabled.filter((action) => action !== "build_start");
  }

  if (task.status === "spec_ready" && enabled.includes("open_spec")) {
    return enabled.filter((action) => action !== "set_spec");
  }

  return enabled;
};

const ACTION_PRIORITY_BY_ISSUE_TYPE: Record<TaskCard["issueType"], TaskWorkflowAction[]> = {
  epic: [
    "set_spec",
    "set_plan",
    "build_start",
    "qa_start",
    "open_spec",
    "open_planner",
    "open_builder",
    "open_qa",
    "human_approve",
    "human_request_changes",
    "resume_deferred",
    "defer_issue",
    "reset_implementation",
    "reset_task",
  ],
  feature: [
    "set_spec",
    "set_plan",
    "build_start",
    "qa_start",
    "open_spec",
    "open_planner",
    "open_builder",
    "open_qa",
    "human_approve",
    "human_request_changes",
    "resume_deferred",
    "defer_issue",
    "reset_implementation",
    "reset_task",
  ],
  bug: [
    "build_start",
    "qa_start",
    "set_plan",
    "set_spec",
    "open_spec",
    "open_planner",
    "open_builder",
    "open_qa",
    "human_approve",
    "human_request_changes",
    "resume_deferred",
    "defer_issue",
    "reset_implementation",
    "reset_task",
  ],
  task: [
    "build_start",
    "qa_start",
    "set_plan",
    "set_spec",
    "open_spec",
    "open_planner",
    "open_builder",
    "open_qa",
    "human_approve",
    "human_request_changes",
    "resume_deferred",
    "defer_issue",
    "reset_implementation",
    "reset_task",
  ],
};

const isWorkflowAction = (action: TaskAction): action is BaseTaskWorkflowAction =>
  action !== "view_details";

const dedupeActions = <T extends string>(actions: T[]): T[] => Array.from(new Set(actions));

const prioritize = (
  actionPriority: readonly TaskWorkflowAction[],
  prioritizeAhead: readonly TaskWorkflowAction[],
): TaskWorkflowAction[] => {
  const uniqueAhead = dedupeActions(Array.from(prioritizeAhead));
  const seen = new Set(uniqueAhead);
  return [...uniqueAhead, ...actionPriority.filter((action) => !seen.has(action))];
};

const resolvePriorityForTask = (
  task: TaskCard,
  options: ResolveTaskCardActionsOptions,
): TaskWorkflowAction[] => {
  const basePriority =
    ACTION_PRIORITY_BY_ISSUE_TYPE[task.issueType] ?? ACTION_PRIORITY_BY_ISSUE_TYPE.task;
  const qaRejected = isQaRejectedTask(task);

  if (options.hasActiveSession && options.activeSessionRole) {
    const activeSessionViewAction = toRoleSessionViewAction(options.activeSessionRole);
    const sessionViewActionsByOrder = basePriority.filter((action) =>
      SESSION_VIEW_ACTIONS.has(action as SessionRoleViewAction),
    );
    return prioritize(basePriority, [activeSessionViewAction, ...sessionViewActionsByOrder]);
  }

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
    case "blocked": {
      if (qaRejected) {
        return prioritize(basePriority, ["build_start", "open_builder", "open_qa"]);
      }
      return prioritize(basePriority, ["open_builder", "build_start"]);
    }
    case "ai_review": {
      return prioritize(basePriority, [
        "qa_start",
        "human_approve",
        "human_request_changes",
        "open_builder",
      ]);
    }
    case "human_review": {
      return prioritize(basePriority, [
        "human_approve",
        "human_request_changes",
        "qa_start",
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
  const enabled = filterEnabledActions(task, options);
  const priority = resolvePriorityForTask(task, options);
  const orderedEnabled = [
    ...priority.filter((action) => enabled.includes(action)),
    ...enabled.filter((action) => !priority.includes(action)),
  ];
  const primaryAction = orderedEnabled[0] ?? null;

  return {
    primaryAction,
    secondaryActions: primaryAction
      ? orderedEnabled.filter((action) => action !== primaryAction)
      : orderedEnabled,
    allActions: orderedEnabled,
  };
};
