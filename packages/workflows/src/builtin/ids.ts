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

export const BUILTIN_ROLE_IDS = ["spec", "planner", "build", "qa"] as const;
export type BuiltinRoleId = (typeof BUILTIN_ROLE_IDS)[number];

const BUILTIN_ACTION_IDS = [
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
  "remove_worktree",
] as const;
export type BuiltinActionId = (typeof BUILTIN_ACTION_IDS)[number];

const BUILTIN_LAUNCH_ACTION_IDS = [
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

const BUILTIN_SIGNAL_IDS = [
  "taskProgressedToSpecReady",
  "taskProgressedToReadyForDev",
  "taskProgressedToAiReview",
  "taskRejectedByQa",
  "taskProgressedToHumanReview",
] as const;
export type BuiltinSignalId = (typeof BUILTIN_SIGNAL_IDS)[number];

const BUILTIN_AUTOMATION_IDS = [
  "startPlanner",
  "startBuilder",
  "startQa",
  "startReviewQaFeedbacks",
  "startGeneratePullRequest",
] as const;
export type BuiltinAutomationId = (typeof BUILTIN_AUTOMATION_IDS)[number];

/** The prompt IDs of the built-in workflow. Each ID is unique within the workflow. */
const BUILTIN_WORKFLOW_PROMPT_IDS = [
  "workflow.rules",
  "workflow.tool_rules",
  "workflow.task_context",
  "messages.spec_start",
  "messages.plan_start",
  "messages.build_start",
  "messages.build_after_qa_rejection",
  "messages.build_requested_changes",
  "messages.build_pull_request",
  "messages.qa_review",
  "messages.build_git_conflict",
  "workflow.read_only_rejection",
] as const;
export type BuiltinWorkflowPromptId = (typeof BUILTIN_WORKFLOW_PROMPT_IDS)[number];

export type BuiltinNotificationKind = `workflow.${Exclude<BuiltinStateId, "open">}`;
