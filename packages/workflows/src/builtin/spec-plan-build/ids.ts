/**
 * The IDs of the Spec, Plan, Build workflow. The definition uses these types, and a test checks that each
 * list holds the IDs of the definition in definition order.
 */
export const SPEC_PLAN_BUILD_STATE_IDS = [
  "open",
  "spec_ready",
  "ready_for_dev",
  "in_progress",
  "blocked",
  "ai_review",
  "human_review",
  "closed",
] as const;
export type SpecPlanBuildStateId = (typeof SPEC_PLAN_BUILD_STATE_IDS)[number];

const SPEC_PLAN_BUILD_ACTION_IDS = [
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
  "human_request_changes",
  "human_approve",
] as const;
export type SpecPlanBuildActionId = (typeof SPEC_PLAN_BUILD_ACTION_IDS)[number];

const SPEC_PLAN_BUILD_LAUNCH_ACTION_IDS = [
  "spec_initial",
  "planner_initial",
  "build_implementation_start",
  "build_after_qa_rejected",
  "build_after_human_request_changes",
  "build_rebase_conflict_resolution",
  "qa_review",
] as const;
export type SpecPlanBuildLaunchActionId = (typeof SPEC_PLAN_BUILD_LAUNCH_ACTION_IDS)[number];

const SPEC_PLAN_BUILD_SIGNAL_IDS = [
  "taskProgressedToSpecReady",
  "taskProgressedToReadyForDev",
  "taskProgressedToAiReview",
  "taskRejectedByQa",
  "taskProgressedToHumanReview",
] as const;
export type SpecPlanBuildSignalId = (typeof SPEC_PLAN_BUILD_SIGNAL_IDS)[number];

const SPEC_PLAN_BUILD_AUTOMATION_IDS = [
  "startPlanner",
  "startBuilder",
  "startQa",
  "startReviewQaFeedbacks",
  "startGeneratePullRequest",
] as const;
export type SpecPlanBuildAutomationId = (typeof SPEC_PLAN_BUILD_AUTOMATION_IDS)[number];

/** The prompt IDs of the Spec, Plan, Build workflow. Each ID is unique within the workflow. */
const SPEC_PLAN_BUILD_PROMPT_IDS = [
  "workflow.rules",
  "workflow.tool_rules",
  "workflow.task_context",
  "messages.spec_start",
  "messages.plan_start",
  "messages.build_start",
  "messages.build_after_qa_rejection",
  "messages.build_requested_changes",
  "messages.pull_request",
  "messages.qa_review",
  "messages.build_git_conflict",
  "workflow.read_only_rejection",
] as const;
export type SpecPlanBuildPromptId = (typeof SPEC_PLAN_BUILD_PROMPT_IDS)[number];

export type SpecPlanBuildNotificationKind = `workflow.${Exclude<SpecPlanBuildStateId, "open">}`;
