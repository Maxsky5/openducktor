import { z } from "zod";
import { ODT_WORKFLOW_AGENT_TOOL_NAMES } from "./odt-tool-names";

export const agentRoleValues = ["spec", "planner", "build", "qa"] as const;
export const agentSessionStartModeValues = ["fresh", "reuse", "fork"] as const;
export const agentToolNameValues = ODT_WORKFLOW_AGENT_TOOL_NAMES;

export const agentRoleSchema = z.enum(agentRoleValues);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const agentSessionStartModeSchema = z.enum(agentSessionStartModeValues);
export type AgentSessionStartMode = z.infer<typeof agentSessionStartModeSchema>;

export const agentToolNameSchema = z.enum(agentToolNameValues);
export type AgentToolName = z.infer<typeof agentToolNameSchema>;
