import { z } from "zod";
import { ODT_WORKFLOW_AGENT_TOOL_NAMES } from "./odt-tool-names";
import { workflowIdSchema } from "./workflow-condition-schemas";

export const agentSessionStartModeValues = ["fresh", "reuse", "fork"] as const;
export const agentToolNameValues = ODT_WORKFLOW_AGENT_TOOL_NAMES;

/** A role of the task workflow. The workflow of the task validates it. */
export const agentRoleSchema = workflowIdSchema;

export const agentSessionStartModeSchema = z.enum(agentSessionStartModeValues);
export type AgentSessionStartMode = z.infer<typeof agentSessionStartModeSchema>;

export const agentToolNameSchema = z.enum(agentToolNameValues);
export type AgentToolName = z.infer<typeof agentToolNameSchema>;
