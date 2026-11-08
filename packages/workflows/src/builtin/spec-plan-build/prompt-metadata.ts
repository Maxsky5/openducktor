import type { SpecPlanBuildPromptId } from "./ids";

/** The settings labels and descriptions of the Spec, Plan, Build workflow prompts. */
export const SPEC_PLAN_BUILD_PROMPT_LABELS = {
  "workflow.rules": "Workflow Guards",
  "workflow.tool_rules": "Tool Protocol",
  "workflow.task_context": "Task Context",
  "messages.spec_start": "Spec Kickoff",
  "messages.plan_start": "Planner Kickoff",
  "messages.build_start": "Builder Kickoff",
  "messages.build_after_qa_rejection": "Builder Kickoff After QA Rejection",
  "messages.build_requested_changes": "Builder Kickoff After Human Changes",
  "messages.build_goal": "Builder Goal Writer",
  "messages.pull_request": "Pull Request Generation Kickoff",
  "messages.qa_review": "QA Kickoff",
  "messages.build_git_conflict": "Builder Git Conflict Message",
  "workflow.read_only_rejection": "Read-Only Permission Rejection",
} satisfies Record<SpecPlanBuildPromptId, string>;

export const SPEC_PLAN_BUILD_PROMPT_DESCRIPTIONS = {
  "workflow.rules": "Shared lifecycle rules, canonical task documents, and repo guidance.",
  "workflow.tool_rules":
    "Shared ODT tool permissions, task lock, artifact reads, and clarification rules.",
  "workflow.task_context": "Task snapshot and access rules for current workflow documents.",
  "messages.spec_start":
    "Requests a saved specification. Asks questions only for unresolved product decisions.",
  "messages.plan_start": "Requests a saved implementation plan.",
  "messages.build_start":
    "Starts implementation with control over work order and checks within the approved design.",
  "messages.build_after_qa_rejection":
    "Starts review of QA findings, root-cause fixes, and checks for the affected behavior.",
  "messages.build_requested_changes":
    "Starts work on the requested changes while preserving required outcomes and design contracts.",
  "messages.build_goal":
    "Tells a model how to write the goal of a Builder launch in Goal mode from the task material.",
  "messages.pull_request":
    "Starts pull request creation or updates with required checks and task association.",
  "messages.qa_review": "Starts review of required outcomes, contracts, and material risks.",
  "messages.build_git_conflict":
    "Reusable in-session message sent to Builder when a git operation stops on conflicts and must be resolved safely.",
  "workflow.read_only_rejection":
    "Template used to reject mutating tool requests from read-only roles (spec, planner, qa).",
} satisfies Record<SpecPlanBuildPromptId, string>;
