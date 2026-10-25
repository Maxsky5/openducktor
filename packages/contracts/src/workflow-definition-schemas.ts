import { z } from "zod";

import { runtimeSupportedScopeSchema } from "./agent-runtime-schemas";
import { agentSessionStartModeSchema, agentToolNameSchema } from "./agent-workflow-schemas";
import {
  notificationKindSettingSchema,
  workflowNotificationKindSchema,
} from "./notification-schemas";
import {
  workflowArtifactIdSchema,
  workflowConditionSchema,
  workflowFactDefinitionSchema,
  workflowIdSchema,
} from "./workflow-condition-schemas";

/** A role works in the repository or in the task worktree, and may write only there. */
export const workflowRoleDefinitionSchema = z.strictObject({
  id: workflowIdSchema,
  label: z.string(),
  tools: z.array(agentToolNameSchema),
  /** Workflow artifacts that the role may save. */
  writes: z.array(workflowArtifactIdSchema),
  workspaceAccess: z.enum(["read", "write"]),
  location: z.enum(["repository", "task_worktree"]),
  runtimeScopes: z.array(runtimeSupportedScopeSchema),
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

/** No event can leave a terminal state. Events may list it as a source to admit repeats. */
export const workflowStateDefinitionSchema = z.strictObject({
  id: workflowIdSchema,
  label: z.string(),
  title: z.string().optional(),
  /** A compact label for narrow lists. The default is the label. */
  shortLabel: z.string().optional(),
  terminal: z.boolean().optional(),
  notification: workflowStateNotificationSchema.optional(),
  /** The default Agent Studio role. Without it, the first required and available step decides. */
  studioRole: workflowIdSchema.optional(),
});
export type WorkflowStateDefinition = z.infer<typeof workflowStateDefinitionSchema>;

export const workflowPromptTemplateRefSchema = z.strictObject({
  kind: z.enum(["kickoff", "message"]),
  id: workflowIdSchema,
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
  context: z.enum(["human_feedback", "pull_request"]).optional(),
  /** The user chooses the task target branch before the start. */
  targetBranch: z.boolean().optional(),
  /** An automatic continuation needs an existing task worktree. */
  requiresWorktree: z.boolean().optional(),
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
export const workflowAgentStepDefinitionSchema = z.strictObject({
  ...workflowStepDefinitionFields,
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
  stepId: workflowIdSchema.optional(),
  availableWhen: workflowConditionSchema,
};

/**
 * An action is available only when its condition matches and its event, if any, admits the input.
 * An event action sends its event. A session action starts one of its launch actions. A view action
 * changes no state. A view action with a step opens the latest session of the step role.
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
 * The host effects. A host command finds its event through its effect and runs the effect when the
 * event admits the task. A `status.set` event moves the task to the state of its one outcome.
 */
export const workflowEventEffectValues = [
  "status.set",
  "build.start",
  "build.blocked",
  "build.resumed",
  "build.completed",
  "review.approve",
  "review.request_changes",
  "task.close",
  "task.reset",
  "implementation.reset",
  "pull_request.manage",
  "pull_request.merged",
  "direct_merge.local",
  "direct_merge.publish",
  "direct_merge.completed",
] as const;
export const workflowEventEffectSchema = z.enum(workflowEventEffectValues);
export type WorkflowEventEffect = z.infer<typeof workflowEventEffectSchema>;

/** Guards run in order after the source check. The first matching outcome decides the result. */
export const workflowEventDefinitionSchema = z.strictObject({
  id: workflowIdSchema,
  from: z.array(workflowIdSchema).min(1),
  guards: z.array(workflowEventGuardSchema),
  outcomes: z.array(workflowEventOutcomeSchema).min(1),
  effect: workflowEventEffectSchema.optional(),
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

/** An Autopilot action. It starts its launch action, or forks the latest session of its role. */
export const workflowAutomationDefinitionSchema = z.strictObject({
  id: workflowIdSchema,
  label: z.string(),
  description: z.string(),
  launchActionId: workflowIdSchema,
  start: z.enum(["launch_action", "latest_role_session"]),
});
export type WorkflowAutomationDefinition = z.infer<typeof workflowAutomationDefinitionSchema>;

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
  facts: z.array(workflowFactDefinitionSchema),
  roles: z.array(workflowRoleDefinitionSchema),
  artifacts: z.array(workflowArtifactDefinitionSchema),
  states: z.array(workflowStateDefinitionSchema),
  initialState: workflowIdSchema,
  steps: z.array(workflowStepDefinitionSchema),
  actions: z.array(workflowActionDefinitionSchema),
  events: z.array(workflowEventDefinitionSchema),
  signals: z.array(workflowSignalDefinitionSchema),
  automations: z.array(workflowAutomationDefinitionSchema),
  actionOrder: z.array(workflowActionRuleSchema),
  actionPriority: z.array(workflowActionRuleSchema),
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

type DeepReadonly<Value> = Value extends object
  ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
  : Value;

export type CompiledWorkflowDefinition = DeepReadonly<WorkflowDefinition>;
