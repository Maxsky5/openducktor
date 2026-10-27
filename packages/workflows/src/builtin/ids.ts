/**
 * The IDs of the built-in task workflow. The definition uses these types, and a test checks that each
 * list holds the IDs of the definition in definition order.
 */
export const BUILTIN_STATE_IDS = [
  "open",
  "spec_ready",
  "ready_for_dev",
  "in_progress",
  "blocked",
  "ai_review",
  "human_review",
  "closed",
] as const;
export type BuiltinStateId = (typeof BUILTIN_STATE_IDS)[number];

export const BUILTIN_ISSUE_TYPE_IDS = ["task", "feature", "bug"] as const;
export type BuiltinIssueTypeId = (typeof BUILTIN_ISSUE_TYPE_IDS)[number];

export const BUILTIN_ROLE_IDS = ["spec", "planner", "build", "qa"] as const;
export type BuiltinRoleId = (typeof BUILTIN_ROLE_IDS)[number];

export const BUILTIN_ACTION_IDS = [
  "view_details",
  "set_spec",
  "set_plan",
  "build_start",
  "qa_start",
  "open_spec",
  "open_planner",
  "open_builder",
  "open_qa",
  "reset_implementation",
  "reset_task",
  "close_task",
  "human_request_changes",
  "human_approve",
] as const;
export type BuiltinActionId = (typeof BUILTIN_ACTION_IDS)[number];

export const BUILTIN_LAUNCH_ACTION_IDS = [
  "spec_initial",
  "planner_initial",
  "build_implementation_start",
  "build_after_qa_rejected",
  "build_after_human_request_changes",
  "build_pull_request_generation",
  "build_rebase_conflict_resolution",
  "qa_review",
] as const;
export type BuiltinLaunchActionId = (typeof BUILTIN_LAUNCH_ACTION_IDS)[number];

export const BUILTIN_SIGNAL_IDS = [
  "taskProgressedToSpecReady",
  "taskProgressedToReadyForDev",
  "taskProgressedToAiReview",
  "taskRejectedByQa",
  "taskProgressedToHumanReview",
] as const;
export type BuiltinSignalId = (typeof BUILTIN_SIGNAL_IDS)[number];

export const BUILTIN_AUTOMATION_IDS = [
  "startPlanner",
  "startBuilder",
  "startQa",
  "startReviewQaFeedbacks",
  "startGeneratePullRequest",
] as const;
export type BuiltinAutomationId = (typeof BUILTIN_AUTOMATION_IDS)[number];

export const BUILTIN_PROMPT_TEMPLATE_IDS = [
  "system.shared.workflow_guards",
  "system.shared.tool_protocol",
  "system.shared.task_context",
  "system.role.spec.base",
  "system.role.planner.base",
  "system.role.build.base",
  "system.role.qa.base",
  "kickoff.spec_initial",
  "kickoff.planner_initial",
  "kickoff.build_implementation_start",
  "kickoff.build_after_qa_rejected",
  "kickoff.build_after_human_request_changes",
  "kickoff.build_pull_request_generation",
  "kickoff.qa_review",
  "message.build_rebase_conflict_resolution",
  "permission.read_only.reject",
] as const;
export type BuiltinPromptTemplateId = (typeof BUILTIN_PROMPT_TEMPLATE_IDS)[number];

export type BuiltinNotificationKind = `workflow.${Exclude<BuiltinStateId, "open">}`;

const parseId = <Id extends string>(ids: readonly Id[], kind: string, value: string): Id => {
  const id = ids.find((candidate) => candidate === value);
  if (id === undefined) {
    throw new Error(
      `The built-in workflow has no ${kind} "${value}". Report this host data error.`,
    );
  }
  return id;
};

/** The built-in role of a role ID from host data. */
export const builtinRoleId = (value: string): BuiltinRoleId =>
  parseId(BUILTIN_ROLE_IDS, "role", value);

/** The built-in state of a status from host data. */
export const builtinStateId = (value: string): BuiltinStateId =>
  parseId(BUILTIN_STATE_IDS, "state", value);

/** The built-in issue type of an issue type from host data. */
export const builtinIssueTypeId = (value: string): BuiltinIssueTypeId =>
  parseId(BUILTIN_ISSUE_TYPE_IDS, "issue type", value);

/** The built-in automation of an Autopilot action ID from host data. */
export const builtinAutomationId = (value: string): BuiltinAutomationId =>
  parseId(BUILTIN_AUTOMATION_IDS, "automation", value);
