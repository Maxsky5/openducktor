import { z } from "zod";
import { type RuntimeKind, runtimeKindSchema } from "./agent-runtime-schemas";
import { agentRoleSchema } from "./agent-workflow-schemas";

const nonEmptyStringSchema = z.string().trim().min(1);

export const agentSessionLiveRefSchema = z
  .object({
    repoPath: nonEmptyStringSchema,
    runtimeKind: runtimeKindSchema,
    workingDirectory: nonEmptyStringSchema,
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
