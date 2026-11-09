// Prompt samples from packages/workflows/src/builtin/spec-plan-build/agent-prompts.ts.
// The append text that the visitor types is a sample. Sources: settings-prompt-home.tsx,
// settings-prompt-workflow-page.tsx, settings-prompt-layer-editor.tsx, settings-prompt-layers.ts,
// and settings-modal-constants.ts in packages/frontend/src/components/features/settings, and
// workflow-prompt-settings.ts in packages/frontend-core/src/queries. src/copied-settings.test.ts
// compares the labels with the app.

import type { RoleId } from "../../replicas/vocabulary";

/** The labels of SETTINGS_SECTIONS in the order of the app. */
export const SECTION_LABELS = [
  "General",
  "Appearance",
  "Remote control",
  "Git",
  "Agent runtimes",
  "Repositories",
  "System prompts",
  "Reusable prompts",
  "Custom agent roles",
  "Sessions",
  "Notifications",
  "Kanban",
  "Autopilot",
] as const;

export type SectionLabel = (typeof SECTION_LABELS)[number];

/** The section that the scene shows. */
export const ACTIVE_SECTION: SectionLabel = "System prompts";

/** A workflow prompt: what it does, and the roles that get it. */
type PromptRow = { label: string; description: string; roles: readonly RoleId[] };

/** The prompts of a workflow that the agent gets at the same moment. */
export type PromptGroup = { title: string; description: string; rows: readonly PromptRow[] };

/** The instructions of one role, which start each session of the role. */
type RolePrompt = { role: RoleId; description: string };

/** The role instructions of the first screen, as the app lists them. */
export const ROLE_PROMPTS: readonly RolePrompt[] = [
  {
    role: "spec",
    description:
      "Resolves product decisions with the user and defines scope, required behavior, and constraints.",
  },
  {
    role: "planner",
    description:
      "Defines architecture, module responsibilities, interfaces, and contracts. Leaves implementation order and verification to Builder.",
  },
  {
    role: "build",
    description:
      "Completes the approved outcomes and design contracts with control over implementation, work order, and verification.",
  },
  {
    role: "qa",
    description:
      "Reviews required outcomes, design contracts, correctness, and maintainability with checks based on risk.",
  },
];

/** The prompts of one workflow, by when the agent gets them. */
type WorkflowPrompts = { title: string; description: string; groups: readonly PromptGroup[] };

/** The page of the Spec, Plan, Build workflow. */
export const WORKFLOW_SECTION: WorkflowPrompts = {
  title: "Spec, Plan, Build",
  description:
    "The prompts that this workflow uses in its steps. A change applies to every task of this workflow.",
  groups: [
    {
      title: "Rules for every session",
      description: "Added to the system prompt of each session, after the role instructions.",
      rows: [
        {
          label: "Workflow Guards",
          description: "Shared lifecycle rules, canonical task documents, and repo guidance.",
          roles: [],
        },
        {
          label: "Tool Protocol",
          description:
            "Shared ODT tool permissions, task lock, artifact reads, and clarification rules.",
          roles: [],
        },
        {
          label: "Task Context",
          description: "Task snapshot and access rules for current workflow documents.",
          roles: [],
        },
      ],
    },
    {
      title: "Messages to agents",
      description: "Sent to an agent to start a step or to continue its work.",
      rows: [
        {
          label: "Spec Kickoff",
          description:
            "Requests a saved specification. Asks questions only for unresolved product decisions.",
          roles: ["spec"],
        },
        {
          label: "Planner Kickoff",
          description: "Requests a saved implementation plan.",
          roles: ["planner"],
        },
        {
          label: "Builder Kickoff",
          description:
            "Starts implementation with control over work order and checks within the approved design.",
          roles: ["build"],
        },
        {
          label: "Builder Kickoff After QA Rejection",
          description:
            "Starts review of QA findings, root-cause fixes, and checks for the affected behavior.",
          roles: ["build"],
        },
        {
          label: "Builder Kickoff After Human Changes",
          description:
            "Starts work on the requested changes while preserving required outcomes and design contracts.",
          roles: ["build"],
        },
        {
          label: "Pull Request Generation Kickoff",
          description:
            "Starts pull request creation or updates with required checks and task association.",
          roles: ["build"],
        },
        {
          label: "QA Kickoff",
          description: "Starts review of required outcomes, contracts, and material risks.",
          roles: ["qa"],
        },
        {
          label: "Builder Git Conflict Message",
          description:
            "Reusable in-session message sent to Builder when a git operation stops on conflicts and must be resolved safely.",
          roles: ["build"],
        },
      ],
    },
    {
      title: "Goal mode",
      description: "Tells a model how to write the goal when you start a step in Goal mode.",
      rows: [
        {
          label: "Goal Writer",
          description:
            "Tells a model how to write the goal of a Goal mode launch from the task material.",
          roles: [],
        },
      ],
    },
    {
      title: "Replies to agents",
      description: "Sent back to an agent when OpenDucktor refuses one of its actions.",
      rows: [
        {
          label: "Read-Only Permission Rejection",
          description:
            "Template used to reject mutating tool requests from read-only roles (spec, planner, qa).",
          roles: [],
        },
      ],
    },
  ],
};

/** The QA Kickoff prompt: its label, owner, when the agent gets it, and description. */
export const QA_KICKOFF_CARD = {
  label: "QA Kickoff",
  owner: "Spec, Plan, Build",
  usage: "First message to the QA agent",
  description: "Starts review of required outcomes, contracts, and material risks.",
};

/** The placeholders that the QA Kickoff prompt can fill. */
export const QA_KICKOFF_PLACEHOLDERS = [
  "role",
  "role.allowedTools",
  "task.id",
  "task.title",
  "task.issueType",
  "task.status",
  "task.description",
] as const;

/** The status badges that the scene shows, as PROMPT_STATUS_LABELS names them. */
export const STATUS_LABELS = { appended: "Appended" } as const;

/** The labels of the final text parts, as PROMPT_LAYER_LABELS names them. */
export const LAYER_LABELS = {
  builtin: "Built-in",
  global_append: "Append · all repositories",
} as const;

/** The QA Kickoff prompt (messages.qa_review). */
export const QA_KICKOFF =
  "Review this task's implementation and submit one QA report with exactly one odt_set_task_artifact call using code qaReport and verdict approved or rejected. Use taskId {{task.id}} for every task-bound odt_* tool call.";

/** The append instructions that the visitor types. */
export const APPEND_TEXT =
  "Also check that the user docs match the change. List each doc that you read under ## Verification.";
