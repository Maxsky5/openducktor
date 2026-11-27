import {
  agentToolNameSchema,
  isOdtManagedOnlyToolName,
  ODT_READ_ONLY_TOOL_NAMES,
  ODT_WORKFLOW_AGENT_TOOL_NAMES,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { AgentToolName } from "../types/agent-orchestrator";

export const ODT_WORKFLOW_TOOL_NAMES =
  ODT_WORKFLOW_AGENT_TOOL_NAMES satisfies readonly AgentToolName[];

type WorkflowToolAliasesByCanonical = RuntimeDescriptor["workflowToolAliasesByCanonical"];

const ODT_WORKFLOW_READ_ONLY_TOOL_SET = new Set<string>(ODT_READ_ONLY_TOOL_NAMES);

/**
 * Tools that change task or workflow state. Managed session tools (browser and HTML previews)
 * never mutate task records, so they are not workflow mutations.
 */
const ODT_WORKFLOW_MUTATION_TOOL_NAMES = ODT_WORKFLOW_TOOL_NAMES.filter(
  (tool) => !ODT_WORKFLOW_READ_ONLY_TOOL_SET.has(tool) && !isOdtManagedOnlyToolName(tool),
);
const ODT_WORKFLOW_MUTATION_TOOL_SET = new Set<AgentToolName>(ODT_WORKFLOW_MUTATION_TOOL_NAMES);

const resolveCanonicalOdtWorkflowToolName = (toolId: string): AgentToolName | null => {
  const parsed = agentToolNameSchema.safeParse(toolId);
  return parsed.success ? parsed.data : null;
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

export const normalizeOdtWorkflowToolName = (
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
