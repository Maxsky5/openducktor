import { z } from "zod";

import { runtimeSupportedScopeSchema } from "./agent-runtime-schemas";
import { agentSessionStartModeSchema, agentToolNameSchema } from "./agent-workflow-schemas";
import { issueTypeSchema } from "./issue-type-schemas";
import { agentPromptPlaceholderSchema, WORKFLOW_MESSAGE_PROMPT_PREFIX } from "./prompt-schemas";
import {
  notificationKindSettingSchema,
  workflowNotificationKindSchema,
} from "./notification-schemas";
import {
  workflowActionEmphasisSchema,
  workflowActionSurfaceSchema,
  workflowIconSchema,
  workflowSessionActivitySchema,
  workflowToneSchema,
} from "./workflow-display-schemas";
import {
  workflowArtifactIdSchema,
  workflowConditionSchema,
  workflowFactDefinitionSchema,
  workflowIdSchema,
} from "./workflow-condition-schemas";

/**
 * The system prompt of an agent role. The role owns it, so its prompt ID is always "system".
 * Overrides keep its required placeholders.
 */
export const agentRoleSystemPromptSchema = z.strictObject({
  builtinVersion: z.number().int().positive(),
  template: z.string(),
  requiredPlaceholders: z.array(agentPromptPlaceholderSchema).optional(),
  label: z.string(),
  description: z.string(),
});
export type AgentRoleSystemPrompt = z.infer<typeof agentRoleSystemPromptSchema>;

/**
 * An agent role of the host role catalog. Workflows bind roles by ID, so one role keeps its tools,
 * access, prompt, and settings in every workflow that uses it.
 */
export const agentRoleDefinitionSchema = z.strictObject({
  id: workflowIdSchema,
  label: z.string(),
  tools: z.array(agentToolNameSchema),
  workspaceAccess: z.enum(["read", "write"]),
  /** A role works in the repository or in the task worktree, and may write only there. */
  location: z.enum(["repository", "task_worktree"]),
  runtimeScopes: z.array(runtimeSupportedScopeSchema),
  systemPrompt: agentRoleSystemPromptSchema,
  icon: workflowIconSchema.optional(),
  /** The Agent Studio side panel that opens first. The default is the document panel. */
  defaultPanel: z.enum(["document", "diffs"]).optional(),
});
export type AgentRoleDefinition = z.infer<typeof agentRoleDefinitionSchema>;

/** A catalog role that a workflow uses, with what the role may do in this workflow. */
export const workflowRoleDefinitionSchema = z.strictObject({
  id: workflowIdSchema,
  /** Workflow artifacts that the role may save. */
  writes: z.array(workflowArtifactIdSchema),
  /** The document that the side panel shows first. The default is the first output of the step. */
  defaultArtifact: workflowArtifactIdSchema.optional(),
});
export type WorkflowRoleDefinition = z.infer<typeof workflowRoleDefinitionSchema>;

export const workflowArtifactVerdictSchema = z.strictObject({
  id: workflowIdSchema,
  label: z.string(),
  /** A passing verdict accepts the reviewed work. */
  passes: z.boolean(),
  /** The event that a save with this verdict sends. */
  eventId: workflowIdSchema,
});
export type WorkflowArtifactVerdict = z.infer<typeof workflowArtifactVerdictSchema>;

/** A document is stored text. A review is stored text with one of its verdicts. */
export const workflowArtifactDefinitionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: workflowArtifactIdSchema,
    label: z.string(),
    /** A compact label for tabs and buttons. The default is the label. */
    shortLabel: z.string().optional(),
    kind: z.literal("document"),
    /** The event that a save sends. Without it, a save changes only the document. */
    saveEventId: workflowIdSchema.optional(),
    /** The editor text before the user writes. */
    placeholder: z.string().optional(),
  }),
  z.strictObject({
    id: workflowArtifactIdSchema,
    label: z.string(),
    shortLabel: z.string().optional(),
    kind: z.literal("review"),
    verdicts: z.array(workflowArtifactVerdictSchema).min(1),
  }),
]);
export type WorkflowArtifactDefinition = z.infer<typeof workflowArtifactDefinitionSchema>;

/** The notification that a move to the state sends. */
export const workflowStateNotificationSchema = z.strictObject({
  kind: workflowNotificationKindSchema,
  /** The setting before the user changes it. */
  defaultSetting: notificationKindSettingSchema,
  /** The name and description of the notification setting. */
  label: z.string(),
  description: z.string(),
  title: z.string(),
  body: z.string(),
  status: z.string(),
  route: z.enum(["kanban", "agent_studio"]),
  /** The Agent Studio role to open when the transition names no source role. */
  role: workflowIdSchema.optional(),
});
export type WorkflowStateNotification = z.infer<typeof workflowStateNotificationSchema>;

/** The core state of every workflow where a new or reset task starts. */
export const TASK_OPEN_STATE = "open";
/**
 * The core terminal state of every workflow. Close Task moves a task to it. No event can leave it.
 * Events may list it as a source to admit repeats.
 */
export const TASK_CLOSED_STATE = "closed";
/**
 * The core launch that creates or updates the pull request of a task. OpenDucktor owns it, so no
 * workflow declares it. Workflow automations and launch order rules can name it.
 */
export const PULL_REQUEST_LAUNCH_ID = "pull_request";

/**
 * A workflow state. Every workflow declares the core states `open` and `closed` with its other
 * states, so it gives their labels, tone, and notification.
 */
export const workflowStateDefinitionSchema = z.strictObject({
  id: workflowIdSchema,
  label: z.string(),
  title: z.string().optional(),
  /** A compact label for narrow lists. The default is the label. */
  shortLabel: z.string().optional(),
  /** The column and badge tone. The default is neutral. */
  tone: workflowToneSchema.optional(),
  notification: workflowStateNotificationSchema.optional(),
  /** The default Agent Studio role. Without it, the first required and available step decides. */
  studioRole: workflowIdSchema.optional(),
  /** The roles whose latest session Agent Studio opens first. The default is the Studio role. */
  historyRoles: z.array(workflowIdSchema).optional(),
  /**
   * Open the latest session of any role when no history role has one. The default is true only
   * in `closed`.
   */
  historyLatest: z.boolean().optional(),
  /** Merge detection checks the task branch of a task in this state. The default is false. */
  mergeDetection: z.boolean().optional(),
});
export type WorkflowStateDefinition = z.infer<typeof workflowStateDefinitionSchema>;

export const workflowPromptTemplateRefSchema = z.strictObject({
  kind: z.enum(["kickoff", "message"]),
  id: workflowIdSchema.refine(
    (id) => id.startsWith(WORKFLOW_MESSAGE_PROMPT_PREFIX),
    `A launch action prompt ID starts with "${WORKFLOW_MESSAGE_PROMPT_PREFIX}".`,
  ),
});

/** One way to start or continue an agent session for a step. */
export const workflowLaunchActionDefinitionSchema = z.strictObject({
  id: workflowIdSchema,
  label: z.string(),
  startModes: z.array(agentSessionStartModeSchema).min(1),
  defaultStartMode: agentSessionStartModeSchema,
  template: workflowPromptTemplateRefSchema,
  /** The first candidate whose condition matches is the default. Without a match, the first one is. */
  selectWhen: workflowConditionSchema.optional(),
  /** Extra prompt context that the session start must collect. */
  context: z.enum(["human_feedback"]).optional(),
  /** The user chooses the task target branch before the start. */
  targetBranch: z.boolean().optional(),
  /** An automatic continuation needs an existing task worktree. */
  requiresWorktree: z.boolean().optional(),
  /** An extra control in Agent Studio or in the Git conflict panel. Without it, only the step shows it. */
  surface: z.enum(["studio", "git_conflict"]).optional(),
  /** When the extra control shows. The default is always. */
  showWhen: workflowConditionSchema.optional(),
  description: z.string().optional(),
  /**
   * The launch offers Goal mode when the workflow also provides the goal prompt `workflow.goal`.
   * The default text can use `{{task.id}}` and `{{task.title}}`.
   */
  goal: z.strictObject({ defaultObjective: z.string().trim().min(1) }).optional(),
});
export type WorkflowLaunchActionDefinition = z.infer<typeof workflowLaunchActionDefinitionSchema>;

/** Artifact inputs and outputs do not control availability or progress. */
const workflowStepDefinitionFields = {
  id: workflowIdSchema,
  label: z.string(),
  inputs: z.array(workflowArtifactIdSchema),
  outputs: z.array(workflowArtifactIdSchema),
  requiredWhen: workflowConditionSchema,
  availableWhen: workflowConditionSchema,
  completedWhen: workflowConditionSchema,
};

/** The launch actions are the candidates for the default continuation of the step. */
/**
 * A progress display rule of an agent step. The first matching rule decides each display property.
 * A rule matches when its condition matches and the live session of the step role is in `session`.
 */
export const workflowStepDisplayRuleSchema = z.strictObject({
  when: workflowConditionSchema,
  session: z.array(workflowSessionActivitySchema).optional(),
  completion: z.enum(["not_started", "in_progress", "done", "rejected"]).optional(),
  attention: z.enum(["none", "needs_input"]).optional(),
});
export type WorkflowStepDisplayRule = z.infer<typeof workflowStepDisplayRuleSchema>;

export const workflowAgentStepDefinitionSchema = z.strictObject({
  ...workflowStepDefinitionFields,
  displayRules: z.array(workflowStepDisplayRuleSchema).optional(),
  kind: z.literal("agent"),
  roleId: workflowIdSchema,
  launchActions: z.array(workflowLaunchActionDefinitionSchema).min(1),
  /** The event that a session start of this step must admit, and that its startup sends. */
  startEventId: workflowIdSchema.optional(),
});
export type WorkflowAgentStepDefinition = z.infer<typeof workflowAgentStepDefinitionSchema>;

export const workflowHumanStepDefinitionSchema = z.strictObject({
  ...workflowStepDefinitionFields,
  kind: z.literal("human"),
});
export type WorkflowHumanStepDefinition = z.infer<typeof workflowHumanStepDefinitionSchema>;

export const workflowStepDefinitionSchema = z.discriminatedUnion("kind", [
  workflowAgentStepDefinitionSchema,
  workflowHumanStepDefinitionSchema,
]);
export type WorkflowStepDefinition = z.infer<typeof workflowStepDefinitionSchema>;

/** The first matching variant replaces the action label. */
export const workflowLabelVariantSchema = z.strictObject({
  when: workflowConditionSchema,
  label: z.string(),
});
export type WorkflowLabelVariant = z.infer<typeof workflowLabelVariantSchema>;

const workflowActionDefinitionFields = {
  id: workflowIdSchema,
  label: z.string(),
  labels: z.array(workflowLabelVariantSchema).optional(),
  /** One sentence that tells what the action does. Menus show it under the label. */
  description: z.string().optional(),
  stepId: workflowIdSchema.optional(),
  availableWhen: workflowConditionSchema,
  /** The surfaces that show the action. The default is every surface. */
  surfaces: z.array(workflowActionSurfaceSchema).optional(),
  /** The default is neutral. */
  emphasis: workflowActionEmphasisSchema.optional(),
  icon: workflowIconSchema.optional(),
  /** The base label in Agent Studio. Label variants still apply. */
  studioLabel: z.string().optional(),
};

/**
 * An action is available only when its condition matches and its event, if any, admits the input.
 * An event action sends its event. A session action starts one of its launch actions. A view action
 * changes no state. A view action with a step opens the latest session of the step role. An
 * approval action opens the OpenDucktor approval. The workflow only gives when it is available.
 */
export const workflowActionDefinitionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...workflowActionDefinitionFields,
    kind: z.literal("event"),
    eventId: workflowIdSchema,
    /** The session that the UI starts after the event. */
    launchActionIds: z.array(workflowIdSchema).optional(),
  }),
  z.strictObject({
    ...workflowActionDefinitionFields,
    kind: z.literal("session"),
    eventId: workflowIdSchema.optional(),
    launchActionIds: z.array(workflowIdSchema).min(1),
  }),
  z.strictObject({
    ...workflowActionDefinitionFields,
    kind: z.literal("view"),
    /** The destination of a view action without a step. The default is the task details. */
    target: z.enum(["task_details"]).optional(),
  }),
  z.strictObject({
    ...workflowActionDefinitionFields,
    kind: z.literal("approval"),
  }),
]);
export type WorkflowActionDefinition = z.infer<typeof workflowActionDefinitionSchema>;

/** A transition to another state can send an Autopilot signal and name the role that caused it. */
export const workflowEventOutcomeSchema = z.strictObject({
  when: workflowConditionSchema,
  to: workflowIdSchema.nullable(),
  signal: workflowIdSchema.optional(),
  sourceRole: workflowIdSchema.optional(),
});
export type WorkflowEventOutcome = z.infer<typeof workflowEventOutcomeSchema>;

export const workflowEventGuardSchema = z.strictObject({
  id: workflowIdSchema,
  when: workflowConditionSchema,
  /** The recovery that a denial by this guard reports. */
  message: z.string().optional(),
});
export type WorkflowEventGuard = z.infer<typeof workflowEventGuardSchema>;

/**
 * The host effects. The host owns them, and any workflow event can run them. The host runs the
 * effects of an event in order, then commits the event. When an effect fails, the host commits
 * nothing.
 *
 * - `worktree.reset`: stops the sessions of the worktree roles, runs the cleanup script, removes
 *   their other worktrees and branches, restores the task worktree to its start point, and clears
 *   the sessions of the worktree roles, the review artifacts, the pull request link, and the merge
 *   record.
 */
export const HOST_EFFECT_IDS = ["worktree.reset"] as const;
export const hostEffectIdSchema = z.enum(HOST_EFFECT_IDS);
export type HostEffectId = z.infer<typeof hostEffectIdSchema>;

/**
 * An event that agents of the roles may send with `odt_apply_workflow_event`. The role prompt
 * lists it with its description. A required note tells why the agent sends the event.
 */
export const workflowAgentEventSchema = z.strictObject({
  roles: z.array(workflowIdSchema).min(1),
  description: z.string().trim().min(1),
  note: z.enum(["required", "optional"]),
});
export type WorkflowAgentEvent = z.infer<typeof workflowAgentEventSchema>;

/**
 * Guards run in order after the source check. The first matching outcome decides the result. The
 * host runs the effects in order before it commits the event. Without effects, the event only
 * changes the state. An agent event cannot have effects.
 */
export const workflowEventDefinitionSchema = z.strictObject({
  id: workflowIdSchema,
  from: z.array(workflowIdSchema).min(1),
  guards: z.array(workflowEventGuardSchema),
  outcomes: z.array(workflowEventOutcomeSchema).min(1),
  effects: z.array(hostEffectIdSchema).optional(),
  agent: workflowAgentEventSchema.optional(),
});
export type WorkflowEventDefinition = z.infer<typeof workflowEventDefinitionSchema>;

/** An Autopilot signal and the automations that the user may attach to it. */
export const workflowSignalDefinitionSchema = z.strictObject({
  id: workflowIdSchema,
  label: z.string(),
  description: z.string(),
  automations: z.array(workflowIdSchema),
});
export type WorkflowSignalDefinition = z.infer<typeof workflowSignalDefinitionSchema>;

/** An Autopilot action. It starts its launch action in one of the start modes of that action. */
export const workflowAutomationDefinitionSchema = z.strictObject({
  id: workflowIdSchema,
  label: z.string(),
  description: z.string(),
  launchActionId: workflowIdSchema,
  /** The default start mode of the launch action applies when this is omitted. */
  startMode: agentSessionStartModeSchema.optional(),
});
export type WorkflowAutomationDefinition = z.infer<typeof workflowAutomationDefinitionSchema>;

/** A task issue type and its display. The task workflow derives the `issueType` fact from them. */
/** An issue type that a task workflow supports, with what the workflow shows for it. */
export const workflowIssueTypeDefinitionSchema = z.strictObject({
  id: issueTypeSchema,
  label: z.string(),
  description: z.string().optional(),
  /** Writing advice in the task form. */
  guidance: z.string().optional(),
  icon: workflowIconSchema.optional(),
});
export type WorkflowIssueTypeDefinition = z.infer<typeof workflowIssueTypeDefinitionSchema>;

/**
 * The display order of launch candidates. The first rule whose condition and pull request
 * presence match orders the candidates; other candidates follow in declaration order.
 */
export const workflowLaunchOrderRuleSchema = z.strictObject({
  when: workflowConditionSchema,
  pullRequest: z.boolean().optional(),
  order: z.array(workflowIdSchema),
});
export type WorkflowLaunchOrderRule = z.infer<typeof workflowLaunchOrderRuleSchema>;

/** The first rule whose condition matches gives the action list. */
export const workflowActionRuleSchema = z.strictObject({
  when: workflowConditionSchema,
  actions: z.array(workflowIdSchema),
});
export type WorkflowActionRule = z.infer<typeof workflowActionRuleSchema>;

/**
 * schemaVersion identifies the format. The ID and revision identify the definition. actionOrder
 * gives the base order of actions. actionPriority puts its actions ahead of that order.
 */
export const workflowDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: workflowIdSchema,
  revision: z.number().int().positive(),
  label: z.string(),
  /** Facts of a generic workflow. A task workflow declares `issueTypes` instead. */
  facts: z.array(workflowFactDefinitionSchema).default([]),
  issueTypes: z.array(workflowIssueTypeDefinitionSchema).default([]),
  /** The issue type that a new task form or an import proposes. The default is the first one. */
  defaultIssueType: issueTypeSchema.optional(),
  roles: z.array(workflowRoleDefinitionSchema),
  /** Roles whose sessions can create the pull request. Empty: every task session. */
  pullRequestRoles: z.array(workflowIdSchema).default([]),
  artifacts: z.array(workflowArtifactDefinitionSchema),
  /** The states, with the core states `open` and `closed`. A task starts in `open`. */
  states: z.array(workflowStateDefinitionSchema),
  steps: z.array(workflowStepDefinitionSchema),
  actions: z.array(workflowActionDefinitionSchema),
  events: z.array(workflowEventDefinitionSchema),
  signals: z.array(workflowSignalDefinitionSchema),
  automations: z.array(workflowAutomationDefinitionSchema),
  actionOrder: z.array(workflowActionRuleSchema),
  actionPriority: z.array(workflowActionRuleSchema),
  launchOrder: z.array(workflowLaunchOrderRuleSchema).default([]),
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

type DeepReadonly<Value> = Value extends object
  ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
  : Value;

export type CompiledWorkflowDefinition = DeepReadonly<WorkflowDefinition>;
export type CompiledAgentRoleDefinition = DeepReadonly<AgentRoleDefinition>;
