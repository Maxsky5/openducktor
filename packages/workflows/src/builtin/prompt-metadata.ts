import type { BuiltinRoleId, BuiltinWorkflowPromptId } from "./ids";

/** The settings labels and descriptions of the built-in workflow prompts. */
export const BUILTIN_PROMPT_TEMPLATE_LABELS = {
  "workflow.rules": "Workflow Guards",
  "workflow.tool_rules": "Tool Protocol",
  "workflow.task_context": "Task Context",
  "messages.spec_start": "Spec Kickoff",
  "messages.plan_start": "Planner Kickoff",
  "messages.build_start": "Builder Kickoff",
  "messages.build_after_qa_rejection": "Builder Kickoff After QA Rejection",
  "messages.build_requested_changes": "Builder Kickoff After Human Changes",
  "messages.build_pull_request": "Builder Pull Request Generation Kickoff",
  "messages.qa_review": "QA Kickoff",
  "messages.build_git_conflict": "Builder Git Conflict Message",
  "workflow.read_only_rejection": "Read-Only Permission Rejection",
} satisfies Record<BuiltinWorkflowPromptId, string>;

export const BUILTIN_PROMPT_TEMPLATE_DESCRIPTIONS = {
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
  "messages.build_pull_request":
    "Starts pull request creation or updates with required checks and task association.",
  "messages.qa_review": "Starts review of required outcomes, contracts, and material risks.",
  "messages.build_git_conflict":
    "Reusable in-session message sent to Builder when a git operation stops on conflicts and must be resolved safely.",
  "workflow.read_only_rejection":
    "Template used to reject mutating tool requests from read-only roles (spec, planner, qa).",
} satisfies Record<BuiltinWorkflowPromptId, string>;

/** The settings labels and descriptions of the built-in role system prompts. */
export const ROLE_SYSTEM_PROMPT_METADATA = {
  spec: {
    label: "Spec Role Base",
    description:
      "Resolves product decisions with the user and defines scope, required behavior, and constraints.",
  },
  planner: {
    label: "Planner Role Base",
    description:
      "Defines architecture, module responsibilities, interfaces, and contracts. Leaves implementation order and verification to Builder.",
  },
  build: {
    label: "Builder Role Base",
    description:
      "Completes the approved outcomes and design contracts with control over implementation, work order, and verification.",
  },
  qa: {
    label: "QA Role Base",
    description:
      "Reviews required outcomes, design contracts, correctness, and maintainability with checks based on risk.",
  },
} satisfies Record<BuiltinRoleId, { label: string; description: string }>;
