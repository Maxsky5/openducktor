import { z } from "zod";
import { type RuntimeKind, repoRuntimeRefSchema, runtimeKindSchema } from "./agent-runtime-schemas";
import { agentRoleSchema } from "./agent-workflow-schemas";

const nonEmptyStringSchema = z.string().trim().min(1);

export const runtimeWorkingDirectoryRefSchema = repoRuntimeRefSchema
  .extend({
    workingDirectory: nonEmptyStringSchema,
  })
  .strict();
export type RuntimeWorkingDirectoryRef = z.infer<typeof runtimeWorkingDirectoryRefSchema>;

export const agentSessionLiveRefSchema = runtimeWorkingDirectoryRefSchema
  .extend({
    externalSessionId: nonEmptyStringSchema,
  })
  .strict();
export type AgentSessionLiveRef = z.infer<typeof agentSessionLiveRefSchema>;

export const agentSessionWorkflowScopeSchema = z
  .object({
    kind: z.literal("workflow"),
    taskId: nonEmptyStringSchema,
    role: agentRoleSchema,
  })
  .strict();
export type AgentSessionWorkflowScope = z.infer<typeof agentSessionWorkflowScopeSchema>;

export const agentSessionRepositoryScopeSchema = z
  .object({
    kind: z.literal("repository"),
  })
  .strict();
export type AgentSessionRepositoryScope = z.infer<typeof agentSessionRepositoryScopeSchema>;

export const agentSessionScopeSchema = z.discriminatedUnion("kind", [
  agentSessionWorkflowScopeSchema,
  agentSessionRepositoryScopeSchema,
]);
export type AgentSessionScope = z.infer<typeof agentSessionScopeSchema>;

export const agentSessionUnboundAssociationSchema = z
  .object({
    kind: z.literal("unbound"),
  })
  .strict();
export type AgentSessionUnboundAssociation = z.infer<typeof agentSessionUnboundAssociationSchema>;

export const agentSessionAssociationSchema = z.discriminatedUnion("kind", [
  agentSessionWorkflowScopeSchema,
  agentSessionRepositoryScopeSchema,
  agentSessionUnboundAssociationSchema,
]);
export type AgentSessionAssociation = z.infer<typeof agentSessionAssociationSchema>;

export type AgentTranscriptModelSelection = {
  runtimeKind?: RuntimeKind;
  providerId: string;
  modelId: string;
  variant?: string;
  profileId?: string;
};

const inferredAgentModelSelectionSchema = z
  .object({
    runtimeKind: runtimeKindSchema.optional(),
    providerId: z.string(),
    modelId: z.string(),
    variant: z.string().optional(),
    profileId: z.string().optional(),
  })
  .strict();

export const agentModelSelectionSchema =
  inferredAgentModelSelectionSchema as unknown as z.ZodType<AgentTranscriptModelSelection>;
