import { BUILTIN_ROLE_LABELS, BUILTIN_STATES, type BuiltinState } from "./definition";
import {
  BUILTIN_PROMPT_TEMPLATE_IDS,
  BUILTIN_ROLE_IDS,
  type BuiltinNotificationKind,
  type BuiltinPromptTemplateId,
  type BuiltinRoleId,
} from "./ids";

export const BUILTIN_MODEL_DEFAULT_ROLE_LABELS = {
  ...BUILTIN_ROLE_LABELS,
  spec: "Specification",
} satisfies Record<BuiltinRoleId, string>;

export type BuiltinPromptRoleTabId = "shared" | BuiltinRoleId;

export const BUILTIN_PROMPT_ROLE_TABS: ReadonlyArray<{
  id: BuiltinPromptRoleTabId;
  label: string;
}> = [
  { id: "shared", label: "Shared" },
  ...BUILTIN_ROLE_IDS.map((role) => ({ id: role, label: BUILTIN_ROLE_LABELS[role] })),
];

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

export const resolveBuiltinPromptRoleTab = (
  templateId: BuiltinPromptTemplateId,
): BuiltinPromptRoleTabId => {
  if (templateId.includes(".spec.") || templateId.includes("spec_")) {
    return "spec";
  }
  if (templateId.includes(".planner.") || templateId.includes("planner_")) {
    return "planner";
  }
  if (templateId.includes(".build.") || templateId.includes("build_")) {
    return "build";
  }
  if (templateId.includes(".qa.") || templateId.includes("qa_")) {
    return "qa";
  }
  return "shared";
};

export const BUILTIN_PROMPT_IDS_BY_ROLE = {
  shared: new Array<BuiltinPromptTemplateId>(),
  spec: new Array<BuiltinPromptTemplateId>(),
  planner: new Array<BuiltinPromptTemplateId>(),
  build: new Array<BuiltinPromptTemplateId>(),
  qa: new Array<BuiltinPromptTemplateId>(),
} satisfies Record<BuiltinPromptRoleTabId, BuiltinPromptTemplateId[]>;

for (const templateId of BUILTIN_PROMPT_TEMPLATE_IDS) {
  BUILTIN_PROMPT_IDS_BY_ROLE[resolveBuiltinPromptRoleTab(templateId)].push(templateId);
}

type WorkflowNotificationKind = BuiltinNotificationKind;
type StateNotification = NonNullable<BuiltinState["notification"]>;

const notificationsByKind = new Map(
  BUILTIN_STATES.flatMap((state) =>
    state.notification ? [[state.notification.kind, state.notification] as const] : [],
  ),
);
const notificationOf = (kind: WorkflowNotificationKind): StateNotification => {
  const notification = notificationsByKind.get(kind);
  if (!notification) throw new Error(`The built-in workflow sends no ${kind} notification.`);
  return notification;
};
const byWorkflowNotification = <Value>(read: (notification: StateNotification) => Value) => ({
  "workflow.spec_ready": read(notificationOf("workflow.spec_ready")),
  "workflow.ready_for_dev": read(notificationOf("workflow.ready_for_dev")),
  "workflow.in_progress": read(notificationOf("workflow.in_progress")),
  "workflow.blocked": read(notificationOf("workflow.blocked")),
  "workflow.ai_review": read(notificationOf("workflow.ai_review")),
  "workflow.human_review": read(notificationOf("workflow.human_review")),
  "workflow.closed": read(notificationOf("workflow.closed")),
});

/** The notifications of the built-in workflow, in state order. */
export const BUILTIN_NOTIFICATION_KINDS: readonly BuiltinNotificationKind[] =
  BUILTIN_STATES.flatMap(({ notification }) => (notification ? [notification.kind] : []));
export const BUILTIN_WORKFLOW_NOTIFICATION_COPY = byWorkflowNotification(({ title, body }) => ({
  title,
  body,
}));
export const BUILTIN_WORKFLOW_NOTIFICATION_LABELS = byWorkflowNotification(({ label }) => label);
export const BUILTIN_WORKFLOW_NOTIFICATION_DESCRIPTIONS = byWorkflowNotification(
  ({ description }) => description,
);

export const BUILTIN_DEFAULT_RIGHT_PANEL_BY_ROLE = {
  spec: "document",
  planner: "document",
  build: "diffs",
  qa: "document",
} as const satisfies Record<BuiltinRoleId, "document" | "diffs">;
