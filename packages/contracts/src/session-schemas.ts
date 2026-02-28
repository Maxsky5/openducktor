import { z } from "zod";

const AGENT_SESSION_ROLE_VALUES = ["spec", "planner", "build", "qa"] as const;
const AGENT_SESSION_SCENARIO_VALUES = [
  "spec_initial",
  "planner_initial",
  "build_implementation_start",
  "build_after_qa_rejected",
  "build_after_human_request_changes",
  "qa_review",
] as const;
const AGENT_TOOL_NAME_VALUES = [
  "odt_read_task",
  "odt_set_spec",
  "odt_set_plan",
  "odt_build_blocked",
  "odt_build_resumed",
  "odt_build_completed",
  "odt_qa_approved",
  "odt_qa_rejected",
] as const;

export const agentSessionStatusSchema = z.enum(["starting", "running", "idle", "error", "stopped"]);
export type AgentSessionStatus = z.infer<typeof agentSessionStatusSchema>;

export const agentSessionRoleSchema = z.enum(AGENT_SESSION_ROLE_VALUES);
export type AgentSessionRole = z.infer<typeof agentSessionRoleSchema>;
export type AgentRole = AgentSessionRole;

export const agentSessionScenarioSchema = z.enum(AGENT_SESSION_SCENARIO_VALUES);
export type AgentSessionScenario = z.infer<typeof agentSessionScenarioSchema>;
export type AgentScenario = AgentSessionScenario;

export const agentToolNameSchema = z.enum(AGENT_TOOL_NAME_VALUES);
export type AgentToolName = z.infer<typeof agentToolNameSchema>;

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
