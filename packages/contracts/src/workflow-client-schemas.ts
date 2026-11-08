import { z } from "zod";
import { workflowIdSchema } from "./workflow-condition-schemas";
import { agentRoleDefinitionSchema, workflowDefinitionSchema } from "./workflow-definition-schemas";
import { workflowToneSchema } from "./workflow-display-schemas";
import { agentPromptPlaceholderSchema } from "./prompt-schemas";

import { workflowReferenceSchema } from "./workflow-reference-schemas";
export { workflowReferenceSchema, type WorkflowReference } from "./workflow-reference-schemas";

/** The order of tasks in one board column. */
export const boardTaskOrderSchema = z.enum(["priority_then_created", "updated"]);
export type BoardTaskOrder = z.infer<typeof boardTaskOrderSchema>;

/** A board column. The host resolves its metadata from the workflows that use the state. */
const sharedBoardStateSchema = z.strictObject({
  id: workflowIdSchema,
  label: z.string(),
  title: z.string(),
  shortLabel: z.string(),
  tone: workflowToneSchema,
  taskOrder: boardTaskOrderSchema,
});
export type SharedBoardState = z.infer<typeof sharedBoardStateSchema>;
export const workflowBoardDefinitionSchema = z.strictObject({
  states: z.array(sharedBoardStateSchema),
});
export type WorkflowBoardDefinition = z.infer<typeof workflowBoardDefinitionSchema>;

const workflowPromptTemplateSchema = z.strictObject({
  id: workflowIdSchema,
  purpose: z.enum(["system", "kickoff", "message", "permission", "goal"]),
  builtinVersion: z.number().int().positive(),
  template: z.string(),
  requiredPlaceholders: z.array(agentPromptPlaceholderSchema).optional(),
  label: z.string(),
  description: z.string(),
  /** The roles that use the template. No role marks shared prompt information. */
  roleIds: z.array(workflowIdSchema),
});
export type WorkflowPromptTemplate = z.infer<typeof workflowPromptTemplateSchema>;
/** The definition ID and revision identify the descriptor. */
export const workflowDescriptorSchema = z.strictObject({
  definition: workflowDefinitionSchema,
  templates: z.array(workflowPromptTemplateSchema),
});
export type WorkflowDescriptor = z.infer<typeof workflowDescriptorSchema>;
/** The host role catalog and the workflows that bind its roles. */
export const workflowCatalogSchema = z.strictObject({
  hostInstanceId: z.string().min(1),
  roles: z.array(agentRoleDefinitionSchema),
  workflows: z.array(workflowDescriptorSchema),
});
export type WorkflowCatalog = z.infer<typeof workflowCatalogSchema>;
export const workspaceWorkflowContextSchema = z.strictObject({
  hostInstanceId: z.string().min(1),
  board: workflowBoardDefinitionSchema,
  workflows: z.array(workflowReferenceSchema),
  newTaskWorkflow: workflowReferenceSchema,
});
export type WorkspaceWorkflowContext = z.infer<typeof workspaceWorkflowContextSchema>;
