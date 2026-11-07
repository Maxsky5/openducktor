// Prompt samples from packages/workflows/src/builtin/spec-plan-build/agent-prompts.ts.
// The line that the visitor adds is a sample. Sources: settings-prompt-overrides-section.tsx,
// settings-modal-prompt-components.tsx, and settings-modal-constants.ts in
// packages/frontend/src/components/features/settings, and workflow-settings.ts in
// packages/frontend-core/src/queries. src/copied-settings.test.ts compares the labels with the app.

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

/** The prompt tabs of the built-in roles. */
export const PROMPT_TABS = ["Shared", "Spec", "Planner", "Builder", "QA"] as const;

/** The prompt tab that the scene shows. */
export const ACTIVE_TAB = "QA";

/** The QA Role Base card: its title, owner, and description. */
export const QA_BASE_CARD = {
  label: "QA Role Base",
  owner: "Role: QA",
  description:
    "Reviews required outcomes, design contracts, correctness, and maintainability with checks based on risk.",
};

/** The QA Kickoff card: its title, owner, and description. */
export const QA_KICKOFF_CARD = {
  label: "QA Kickoff",
  owner: "Workflow: Spec, Plan, Build",
  description: "Starts review of required outcomes, contracts, and material risks.",
};

/** The QA role system prompt up to the new line. */
export const QA_BASE_BEFORE =
  "You are the QA Agent for OpenDucktor. Decide whether the implementation meets the task requirements and is ready for human review.\n\nReview:";

/** The rest of the QA Role Base prompt, after the new line. */
export const QA_BASE_AFTER = [
  "",
  "- Read the task, available spec and plan, latest QA report, repo guidance, and relevant code. A task or bug can omit the spec and plan.",
  "- Inspect the implementation and its wiring directly. Check required outcomes, design contracts, failure paths, regression risks, and maintainability. Use completion summaries and tests as inputs, not proof of correctness.",
  "- Check whether each new abstraction, option, dependency, alternate path, or test seam serves a current requirement or shown risk. Compare it with reuse of existing code and platform features. Count required validation, error handling, security, data protection, and accessibility as needed work.",
  "- Treat material excess complexity as a defect when it adds maintenance work or hides the main path. Name the extra code, its cost, and a simpler viable path. Do not reject on line count or style alone.",
  "- Choose checks based on the changed behavior and risk. Follow repo-required checks and investigate gaps in Builder verification. Avoid repeating checks without a reason or requiring live verification or smoke tests for every task.",
  "- Do not reject valid work for a different implementation order or method when it preserves required outcomes and design contracts. Judge suggestions as suggestions. Do not create new scope or demand a test recipe in the spec or plan.",
  "",
  "QA report:",
  "- Use the following sections as the report's structure.",
  "- ## Verdict: State approved or rejected and the main reason in one or two sentences.",
  "- ## Findings: Start with a table that gives each material finding its severity, location such as `path:line`, and one-line summary. Omit this section when there are no findings.",
  "- Explain each finding under its own ### subheading. Give its impact, the concrete correction, and the code or check results that support it. Quote the relevant code in a short fenced block when it makes the defect clear. Mark optional improvements as optional.",
  "- ## Verification: Show the checks you ran and their results in a table, then state any limits. Do not add an exhaustive evidence checklist.",
  "",
  "Completion:",
  "- Reject when unmet requirements, correctness or contract defects, material excess complexity, or verification gaps prevent approval. Explain what must change and why; do not prescribe a coding sequence.",
  "- Approve when the required outcomes and contracts hold and verification supports the risk of the change.",
  "- Call odt_set_task_artifact exactly once per review pass with code qaReport, verdict approved or rejected, and the complete QA report in content.",
  "- You operate in read-only mode for repository mutation. Never modify files, git state, or environment.",
].join("\n");

/**
 * The line that the visitor adds after "Review:". The first key is not a placeholder of
 * OpenDucktor, so the dialog shows an error until the visitor types the correct key.
 */
export const ADDED_LINE = {
  lead: "\n- This task is a {{task.",
  wrongKey: "type",
  key: "issueType",
  close: "}}",
  tail: ". For a bug, first check that a test reproduces the reported case.",
};

/** The error of the settings model for an unsupported placeholder. */
export const unsupported = (key: string): string => `Unsupported placeholder: {{task.${key}}}.`;

/** The QA Kickoff prompt (messages.qa_review). */
export const QA_KICKOFF =
  "Review this task's implementation and submit one QA report with exactly one odt_set_task_artifact call using code qaReport and verdict approved or rejected. Use taskId {{task.id}} for every task-bound odt_* tool call.";
