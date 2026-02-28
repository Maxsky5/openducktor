import { z } from "zod";

export const agentSessionStatusSchema = z.enum(["starting", "running", "idle", "error", "stopped"]);
export type AgentSessionStatus = z.infer<typeof agentSessionStatusSchema>;

export const agentSessionRoleSchema = z.enum(["spec", "planner", "build", "qa"]);
export type AgentSessionRole = z.infer<typeof agentSessionRoleSchema>;

export const agentSessionScenarioSchema = z.enum([
  "spec_initial",
  "planner_initial",
  "build_implementation_start",
  "build_after_qa_rejected",
  "build_after_human_request_changes",
  "qa_review",
]);
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

export const agentSessionRecordSchema = z.object({
  sessionId: z.string(),
  externalSessionId: z.string(),
  taskId: z.string(),
  role: agentSessionRoleSchema,
  scenario: agentSessionScenarioSchema,
  status: agentSessionStatusSchema,
  startedAt: z.string(),
  updatedAt: z.string(),
  endedAt: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  runtimeId: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  runId: z.preprocess((value) => (value === null ? undefined : value), z.string().optional()),
  baseUrl: z.string(),
  workingDirectory: z.string(),
  selectedModel: z.preprocess(
    (value) => (value === null ? undefined : value),
    agentSessionModelSelectionSchema.optional(),
  ),
});
export type AgentSessionRecord = z.infer<typeof agentSessionRecordSchema>;
