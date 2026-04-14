import { z } from "zod";
import { runtimeKindSchema } from "./agent-runtime-schemas";
import { agentRoleSchema, agentScenarioSchema } from "./agent-workflow-schemas";

export const agentSessionStatusSchema = z.enum(["starting", "running", "idle", "error", "stopped"]);
export type AgentSessionStatus = z.infer<typeof agentSessionStatusSchema>;

export const agentSessionRoleSchema = agentRoleSchema;
export type AgentSessionRole = z.infer<typeof agentSessionRoleSchema>;

export const agentSessionScenarioSchema = agentScenarioSchema;
export type AgentSessionScenario = z.infer<typeof agentSessionScenarioSchema>;

const optionalFromNullable = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional());

export const agentSessionModelSelectionSchema = z.object({
  runtimeKind: runtimeKindSchema,
  providerId: z.string(),
  modelId: z.string(),
  variant: optionalFromNullable(z.string()),
  profileId: optionalFromNullable(z.string()),
});
export type AgentSessionModelSelection = z.infer<typeof agentSessionModelSelectionSchema>;

export const agentSessionPermissionRequestSchema = z.object({
  requestId: z.string(),
  permission: z.string(),
  patterns: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AgentSessionPermissionRequest = z.infer<typeof agentSessionPermissionRequestSchema>;

export const agentSessionQuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
});
export type AgentSessionQuestionOption = z.infer<typeof agentSessionQuestionOptionSchema>;

export const agentSessionQuestionItemSchema = z.object({
  header: z.string(),
  question: z.string(),
  options: z.array(agentSessionQuestionOptionSchema).default([]),
  multiple: z.boolean().optional(),
  custom: z.boolean().optional(),
});
export type AgentSessionQuestionItem = z.infer<typeof agentSessionQuestionItemSchema>;

export const agentSessionQuestionRequestSchema = z.object({
  requestId: z.string(),
  questions: z.array(agentSessionQuestionItemSchema).default([]),
});
export type AgentSessionQuestionRequest = z.infer<typeof agentSessionQuestionRequestSchema>;

export const agentSessionRecordSchema = z.object({
  sessionId: z.string(),
  externalSessionId: optionalFromNullable(z.string()),
  role: agentSessionRoleSchema,
  scenario: agentSessionScenarioSchema,
  startedAt: z.string(),
  runtimeKind: runtimeKindSchema,
  workingDirectory: z.string(),
  selectedModel: z.preprocess(
    (value) => (value === undefined ? null : value),
    agentSessionModelSelectionSchema.nullable(),
  ),
});
export type AgentSessionRecord = z.infer<typeof agentSessionRecordSchema>;
