import { z } from "zod";

import {
  workflowConditionSchema,
  workflowFactDefinitionSchema,
  workflowIdSchema,
} from "./workflow-condition-schemas";

export const workflowRoleDefinitionSchema = z.strictObject({
  id: workflowIdSchema,
  label: z.string(),
});
export type WorkflowRoleDefinition = z.infer<typeof workflowRoleDefinitionSchema>;

export const workflowArtifactDefinitionSchema = z.strictObject({
  id: workflowIdSchema,
  label: z.string(),
});
export type WorkflowArtifactDefinition = z.infer<typeof workflowArtifactDefinitionSchema>;

/** No event can leave a terminal state. Events may list it as a source to admit repeats. */
export const workflowStateDefinitionSchema = z.strictObject({
  id: workflowIdSchema,
  label: z.string(),
  title: z.string().optional(),
  terminal: z.boolean().optional(),
});
export type WorkflowStateDefinition = z.infer<typeof workflowStateDefinitionSchema>;

/** Artifact inputs and outputs do not control availability or progress. */
const workflowStepDefinitionFields = {
  id: workflowIdSchema,
  label: z.string(),
  inputs: z.array(workflowIdSchema),
  outputs: z.array(workflowIdSchema),
  requiredWhen: workflowConditionSchema,
  availableWhen: workflowConditionSchema,
  completedWhen: workflowConditionSchema,
};

export const workflowAgentStepDefinitionSchema = z.strictObject({
  ...workflowStepDefinitionFields,
  kind: z.literal("agent"),
  roleId: workflowIdSchema,
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

/** An event action is available only when its condition matches and its event admits the input. */
const workflowActionDefinitionFields = {
  id: workflowIdSchema,
  label: z.string(),
  stepId: workflowIdSchema.optional(),
  availableWhen: workflowConditionSchema,
};

export const workflowActionDefinitionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...workflowActionDefinitionFields,
    kind: z.literal("event"),
    eventId: workflowIdSchema,
  }),
  z.strictObject({
    ...workflowActionDefinitionFields,
    kind: z.literal("view"),
  }),
]);
export type WorkflowActionDefinition = z.infer<typeof workflowActionDefinitionSchema>;

export const workflowEventOutcomeSchema = z.strictObject({
  when: workflowConditionSchema,
  to: workflowIdSchema.nullable(),
});
export type WorkflowEventOutcome = z.infer<typeof workflowEventOutcomeSchema>;

export const workflowEventGuardSchema = z.strictObject({
  id: workflowIdSchema,
  when: workflowConditionSchema,
});
export type WorkflowEventGuard = z.infer<typeof workflowEventGuardSchema>;

/** Guards run in order after the source check. The first matching outcome decides the result. */
export const workflowEventDefinitionSchema = z.strictObject({
  id: workflowIdSchema,
  from: z.array(workflowIdSchema).min(1),
  guards: z.array(workflowEventGuardSchema),
  outcomes: z.array(workflowEventOutcomeSchema).min(1),
});
export type WorkflowEventDefinition = z.infer<typeof workflowEventDefinitionSchema>;

/** schemaVersion identifies the format. The ID and revision identify the definition. */
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
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

type DeepReadonly<Value> = Value extends object
  ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
  : Value;

export type CompiledWorkflowDefinition = DeepReadonly<WorkflowDefinition>;
