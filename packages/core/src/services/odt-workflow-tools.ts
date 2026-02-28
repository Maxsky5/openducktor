import { agentToolNameSchema } from "@openducktor/contracts";
import {
  AGENT_ROLE_TOOL_POLICY,
  type AgentRole,
  type AgentToolName,
} from "../types/agent-orchestrator";

export const ODT_WORKFLOW_TOOL_NAMES =
  agentToolNameSchema.options satisfies readonly AgentToolName[];

const ODT_WORKFLOW_TOOL_SET = new Set<AgentToolName>(ODT_WORKFLOW_TOOL_NAMES);
export const ODT_WORKFLOW_MUTATION_TOOL_NAMES = ODT_WORKFLOW_TOOL_NAMES.filter(
  (tool) => tool !== "odt_read_task",
);
const ODT_WORKFLOW_MUTATION_TOOL_SET = new Set<AgentToolName>(ODT_WORKFLOW_MUTATION_TOOL_NAMES);
const ODT_MCP_TOOL_PREFIXES = ["openducktor_"] as const;

export const normalizeOdtWorkflowToolName = (toolName: string): AgentToolName | null => {
  const normalized = toolName.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  if (ODT_WORKFLOW_TOOL_SET.has(normalized as AgentToolName)) {
    return normalized as AgentToolName;
  }

  const odtMarkerIndex = normalized.lastIndexOf("odt_");
  if (odtMarkerIndex <= 0) {
    return null;
  }

  const candidate = normalized.slice(odtMarkerIndex);
  return ODT_WORKFLOW_TOOL_SET.has(candidate as AgentToolName)
    ? (candidate as AgentToolName)
    : null;
};

export const isOdtWorkflowToolName = (toolName: string): boolean => {
  return normalizeOdtWorkflowToolName(toolName) !== null;
};

export const isOdtWorkflowMutationToolName = (toolName: string): boolean => {
  const normalized = normalizeOdtWorkflowToolName(toolName);
  return normalized ? ODT_WORKFLOW_MUTATION_TOOL_SET.has(normalized) : false;
};

export const toOdtWorkflowToolDisplayName = (toolName: string): string => {
  const normalized = normalizeOdtWorkflowToolName(toolName);
  return normalized ? normalized.slice(4) : toolName;
};

export const buildRoleScopedOdtToolSelection = (
  role: AgentRole,
  options?: { runtimeToolIds?: readonly string[] },
): Record<string, boolean> => {
  const allowed = new Set(AGENT_ROLE_TOOL_POLICY[role]);
  const selection: Record<string, boolean> = {};

  for (const workflowTool of ODT_WORKFLOW_TOOL_NAMES) {
    const enabled = allowed.has(workflowTool);
    selection[workflowTool] = enabled;
    for (const prefix of ODT_MCP_TOOL_PREFIXES) {
      selection[`${prefix}${workflowTool}`] = enabled;
    }
  }

  for (const toolId of options?.runtimeToolIds ?? []) {
    const normalizedTool = normalizeOdtWorkflowToolName(toolId);
    if (!normalizedTool) {
      continue;
    }
    const trimmedToolId = toolId.trim();
    if (trimmedToolId.length === 0) {
      continue;
    }
    selection[trimmedToolId] = allowed.has(normalizedTool);
  }

  return selection;
};
