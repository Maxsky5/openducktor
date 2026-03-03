import { z } from "zod";
import { agentRoleSchema, agentScenarioSchema } from "./agent-workflow-schemas";

export const agentSessionStatusSchema = z.enum(["starting", "running", "idle", "error", "stopped"]);
export type AgentSessionStatus = z.infer<typeof agentSessionStatusSchema>;

export const agentSessionRoleSchema = agentRoleSchema;
export type AgentSessionRole = z.infer<typeof agentSessionRoleSchema>;

export const agentSessionScenarioSchema = agentScenarioSchema;
export type AgentSessionScenario = z.infer<typeof agentSessionScenarioSchema>;

export const agentSessionModelSelectionSchema = z.object({
  providerId: z.string(),
  modelId: z.string(),
  variant: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  opencodeAgent: z.preprocess(
    (value) => (value === null ? undefined : value),
    z.string().optional(),
  ),
});
export type AgentSessionModelSelection = z.infer<typeof agentSessionModelSelectionSchema>;

const optionalStringFromNullable = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().optional(),
);

export const agentSessionRecordSchema = z.object({
  sessionId: z.string(),
  externalSessionId: optionalStringFromNullable,
  taskId: optionalStringFromNullable,
  role: agentSessionRoleSchema,
  scenario: z.preprocess(
    (value) => (value === null ? undefined : value),
    agentSessionScenarioSchema.optional(),
  ),
  status: z.preprocess(
    (value) => (value === null ? undefined : value),
    agentSessionStatusSchema.optional(),
  ),
  startedAt: z.string(),
  updatedAt: optionalStringFromNullable,
  endedAt: optionalStringFromNullable,
  runtimeId: optionalStringFromNullable,
  runId: optionalStringFromNullable,
  baseUrl: optionalStringFromNullable,
  workingDirectory: z.string(),
  selectedModel: z.preprocess(
    (value) => (value === null ? undefined : value),
    agentSessionModelSelectionSchema.optional(),
  ),
});
export type AgentSessionRecord = z.infer<typeof agentSessionRecordSchema>;
