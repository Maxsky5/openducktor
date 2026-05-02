import { ODT_WORKFLOW_AGENT_TOOL_NAMES, type RuntimeDescriptor } from "@openducktor/contracts";
import {
  AGENT_ROLE_TOOL_POLICY,
  type AgentRole,
  type AgentToolName,
} from "../types/agent-orchestrator";

export const ODT_WORKFLOW_TOOL_NAMES =
  ODT_WORKFLOW_AGENT_TOOL_NAMES satisfies readonly AgentToolName[];

export const ODT_WORKFLOW_READ_TOOL_NAMES = [
  "odt_read_task",
  "odt_read_task_documents",
] as const satisfies readonly AgentToolName[];
type WorkflowToolAliasesByCanonical = RuntimeDescriptor["workflowToolAliasesByCanonical"];

const ODT_WORKFLOW_TOOL_SET = new Set<AgentToolName>(ODT_WORKFLOW_TOOL_NAMES);
const ODT_WORKFLOW_READ_TOOL_SET = new Set<AgentToolName>(ODT_WORKFLOW_READ_TOOL_NAMES);

export const ODT_WORKFLOW_MUTATION_TOOL_NAMES = ODT_WORKFLOW_TOOL_NAMES.filter(
  (tool) => !ODT_WORKFLOW_READ_TOOL_SET.has(tool),
);
const ODT_WORKFLOW_MUTATION_TOOL_SET = new Set<AgentToolName>(ODT_WORKFLOW_MUTATION_TOOL_NAMES);

const resolveCanonicalOdtWorkflowToolName = (toolId: string): AgentToolName | null => {
  if (!ODT_WORKFLOW_TOOL_SET.has(toolId as AgentToolName)) {
    return null;
  }

  return toolId as AgentToolName;
};

const resolveAliasedOdtWorkflowToolName = (
  toolId: string,
  workflowToolAliasesByCanonical?: WorkflowToolAliasesByCanonical,
): AgentToolName | null => {
  for (const workflowTool of ODT_WORKFLOW_TOOL_NAMES) {
    if ((workflowToolAliasesByCanonical?.[workflowTool] ?? []).includes(toolId)) {
      return workflowTool;
    }
  }

  return null;
};

const resolveOdtWorkflowToolName = (
  toolId: string,
  workflowToolAliasesByCanonical?: WorkflowToolAliasesByCanonical,
): AgentToolName | null => {
  const trimmedToolId = toolId.trim();
  if (trimmedToolId.length === 0) {
    return null;
  }

  return (
    resolveCanonicalOdtWorkflowToolName(trimmedToolId) ??
    resolveAliasedOdtWorkflowToolName(trimmedToolId, workflowToolAliasesByCanonical)
  );
};

export const normalizeOdtWorkflowToolName = (
  toolName: string,
  workflowToolAliasesByCanonical?: WorkflowToolAliasesByCanonical,
): AgentToolName | null => resolveOdtWorkflowToolName(toolName, workflowToolAliasesByCanonical);

export const resolveOdtWorkflowToolNameForAuthorization = (
  toolId: string,
  workflowToolAliasesByCanonical?: WorkflowToolAliasesByCanonical,
): AgentToolName | null => resolveOdtWorkflowToolName(toolId, workflowToolAliasesByCanonical);

export const isOdtWorkflowToolName = (
  toolName: string,
  workflowToolAliasesByCanonical?: WorkflowToolAliasesByCanonical,
): boolean => normalizeOdtWorkflowToolName(toolName, workflowToolAliasesByCanonical) !== null;

export const isOdtWorkflowMutationToolName = (
  toolName: string,
  workflowToolAliasesByCanonical?: WorkflowToolAliasesByCanonical,
): boolean => {
  const normalized = normalizeOdtWorkflowToolName(toolName, workflowToolAliasesByCanonical);
  return normalized ? ODT_WORKFLOW_MUTATION_TOOL_SET.has(normalized) : false;
};

export const toOdtWorkflowToolDisplayName = (
  toolName: string,
  workflowToolAliasesByCanonical?: WorkflowToolAliasesByCanonical,
): string => {
  const normalized = normalizeOdtWorkflowToolName(toolName, workflowToolAliasesByCanonical);
  return normalized ? normalized.slice(4) : toolName;
};

export const buildRoleScopedOdtToolSelection = (
  role: AgentRole,
  options?: {
    runtimeToolIds?: readonly string[];
    includeCanonicalDefaults?: boolean;
    workflowToolAliasesByCanonical?: WorkflowToolAliasesByCanonical;
  },
): Record<string, boolean> => {
  const allowed = new Set(AGENT_ROLE_TOOL_POLICY[role]);
  const selection: Record<string, boolean> = {};
  const includeCanonicalDefaults = options?.includeCanonicalDefaults ?? true;

  if (includeCanonicalDefaults) {
    for (const workflowTool of ODT_WORKFLOW_TOOL_NAMES) {
      selection[workflowTool] = allowed.has(workflowTool);
      for (const alias of options?.workflowToolAliasesByCanonical?.[workflowTool] ?? []) {
        selection[alias] = allowed.has(workflowTool);
      }
    }
  }

  for (const toolId of options?.runtimeToolIds ?? []) {
    const normalizedTool = resolveOdtWorkflowToolNameForAuthorization(
      toolId,
      options?.workflowToolAliasesByCanonical,
    );
    if (!normalizedTool) {
      continue;
    }
    const trimmedToolId = toolId.trim();
    selection[trimmedToolId] = allowed.has(normalizedTool);
  }

  return selection;
};
