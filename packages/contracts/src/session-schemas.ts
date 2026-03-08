import { z } from "zod";
import { runtimeKindSchema, runtimeTransportSchema } from "./agent-runtime-schemas";
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
  runtimeKind: runtimeKindSchema.default("opencode"),
  providerId: z.string(),
  modelId: z.string(),
  variant: optionalFromNullable(z.string()),
  profileId: optionalFromNullable(z.string()),
});
export type AgentSessionModelSelection = z.infer<typeof agentSessionModelSelectionSchema>;

const optionalStringFromNullable = optionalFromNullable(z.string());

export const agentSessionRecordSchema = z.object({
  sessionId: z.string(),
  externalSessionId: optionalStringFromNullable,
  taskId: optionalStringFromNullable,
  role: agentSessionRoleSchema,
  scenario: optionalFromNullable(agentSessionScenarioSchema),
  status: optionalFromNullable(agentSessionStatusSchema),
  startedAt: z.string(),
  updatedAt: optionalStringFromNullable,
  endedAt: optionalStringFromNullable,
  runtimeKind: runtimeKindSchema.default("opencode"),
  runtimeId: optionalStringFromNullable,
  runId: optionalStringFromNullable,
  runtimeEndpoint: optionalStringFromNullable,
  runtimeTransport: optionalFromNullable(runtimeTransportSchema),
  workingDirectory: z.string(),
  selectedModel: optionalFromNullable(agentSessionModelSelectionSchema),
});
export type AgentSessionRecord = z.infer<typeof agentSessionRecordSchema>;
