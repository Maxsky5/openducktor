import type { BuiltinPromptTemplateId } from "./ids";

/** The settings labels and descriptions of the built-in prompt templates. */
export const BUILTIN_PROMPT_TEMPLATE_LABELS = {
  "system.shared.workflow_guards": "Workflow Guards",
  "system.shared.tool_protocol": "Tool Protocol",
  "system.shared.task_context": "Task Context",
  "system.role.spec.base": "Spec Role Base",
  "system.role.planner.base": "Planner Role Base",
  "system.role.build.base": "Builder Role Base",
  "system.role.qa.base": "QA Role Base",
  "kickoff.spec_initial": "Spec Kickoff",
  "kickoff.planner_initial": "Planner Kickoff",
  "kickoff.build_implementation_start": "Builder Kickoff",
  "kickoff.build_after_qa_rejected": "Builder Kickoff After QA Rejection",
  "kickoff.build_after_human_request_changes": "Builder Kickoff After Human Changes",
  "kickoff.build_pull_request_generation": "Builder Pull Request Generation Kickoff",
  "kickoff.qa_review": "QA Kickoff",
  "message.build_rebase_conflict_resolution": "Builder Git Conflict Message",
  "permission.read_only.reject": "Read-Only Permission Rejection",
} satisfies Record<BuiltinPromptTemplateId, string>;

export const BUILTIN_PROMPT_TEMPLATE_DESCRIPTIONS = {
  "system.shared.workflow_guards":
    "Shared lifecycle rules, canonical task documents, and repo guidance.",
  "system.shared.tool_protocol":
    "Shared ODT tool permissions, task lock, artifact reads, and clarification rules.",
  "system.shared.task_context": "Task snapshot and access rules for current workflow documents.",
  "system.role.spec.base":
    "Resolves product decisions with the user and defines scope, required behavior, and constraints.",
  "system.role.planner.base":
    "Defines architecture, module responsibilities, interfaces, and contracts. Leaves implementation order and verification to Builder.",
  "system.role.build.base":
    "Completes the approved outcomes and design contracts with control over implementation, work order, and verification.",
  "system.role.qa.base":
    "Reviews required outcomes, design contracts, correctness, and maintainability with checks based on risk.",
  "kickoff.spec_initial":
    "Requests a saved specification. Asks questions only for unresolved product decisions.",
  "kickoff.planner_initial": "Requests a saved implementation plan.",
  "kickoff.build_implementation_start":
    "Starts implementation with control over work order and checks within the approved design.",
  "kickoff.build_after_qa_rejected":
    "Starts review of QA findings, root-cause fixes, and checks for the affected behavior.",
  "kickoff.build_after_human_request_changes":
    "Starts work on the requested changes while preserving required outcomes and design contracts.",
  "kickoff.build_pull_request_generation":
    "Starts pull request creation or updates with required checks and task association.",
  "kickoff.qa_review": "Starts review of required outcomes, contracts, and material risks.",
  "message.build_rebase_conflict_resolution":
    "Reusable in-session message sent to Builder when a git operation stops on conflicts and must be resolved safely.",
  "permission.read_only.reject":
    "Template used to reject mutating tool requests from read-only roles (spec, planner, qa).",
} satisfies Record<BuiltinPromptTemplateId, string>;
