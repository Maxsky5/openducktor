import { agentToolNameValues } from "@openducktor/contracts";
import {
  AGENT_ROLE_TOOL_POLICY,
  type AgentRole,
  type AgentToolName,
} from "../types/agent-orchestrator";

export const ODT_WORKFLOW_TOOL_NAMES = agentToolNameValues satisfies readonly AgentToolName[];

export const ODT_WORKFLOW_MUTATION_TOOL_NAMES = ODT_WORKFLOW_TOOL_NAMES.filter(
  (tool) => tool !== "odt_read_task",
);
const ODT_WORKFLOW_MUTATION_TOOL_SET = new Set<AgentToolName>(ODT_WORKFLOW_MUTATION_TOOL_NAMES);
const ODT_MCP_TOOL_PREFIXES = ["openducktor_"] as const;

const createOdtWorkflowRuntimeToolIdMap = (
  mapToolId: (toolId: string) => string,
): ReadonlyMap<string, AgentToolName> => {
  const runtimeToolIdMap = new Map<string, AgentToolName>();
  for (const workflowTool of ODT_WORKFLOW_TOOL_NAMES) {
    runtimeToolIdMap.set(mapToolId(workflowTool), workflowTool);
    for (const prefix of ODT_MCP_TOOL_PREFIXES) {
      runtimeToolIdMap.set(mapToolId(`${prefix}${workflowTool}`), workflowTool);
    }
  }
  return runtimeToolIdMap;
};

const ODT_WORKFLOW_AUTHORIZATION_TOOL_ID_MAP = createOdtWorkflowRuntimeToolIdMap(
  (toolId) => toolId,
);
const ODT_WORKFLOW_NORMALIZED_TOOL_ID_MAP = createOdtWorkflowRuntimeToolIdMap((toolId) =>
  toolId.toLowerCase(),
);

export const normalizeOdtWorkflowToolName = (toolName: string): AgentToolName | null => {
  const normalized = toolName.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  return ODT_WORKFLOW_NORMALIZED_TOOL_ID_MAP.get(normalized) ?? null;
};

export const resolveOdtWorkflowToolNameForAuthorization = (
  toolId: string,
): AgentToolName | null => {
  const trimmedToolId = toolId.trim();
  if (trimmedToolId.length === 0) {
    return null;
  }

  return ODT_WORKFLOW_AUTHORIZATION_TOOL_ID_MAP.get(trimmedToolId) ?? null;
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
  options?: {
    runtimeToolIds?: readonly string[];
    includeCanonicalDefaults?: boolean;
  },
): Record<string, boolean> => {
  const allowed = new Set(AGENT_ROLE_TOOL_POLICY[role]);
  const selection: Record<string, boolean> = {};
  const includeCanonicalDefaults = options?.includeCanonicalDefaults ?? true;

  if (includeCanonicalDefaults) {
    for (const workflowTool of ODT_WORKFLOW_TOOL_NAMES) {
      selection[workflowTool] = allowed.has(workflowTool);
    }
  }

  for (const toolId of options?.runtimeToolIds ?? []) {
    const normalizedTool = resolveOdtWorkflowToolNameForAuthorization(toolId);
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
