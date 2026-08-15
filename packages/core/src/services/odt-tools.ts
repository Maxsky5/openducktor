import {
  ODT_MCP_TOOL_NAMES,
  ODT_WORKSPACE_DISCOVERY_TOOL_NAME,
  type OdtToolName,
} from "@openducktor/contracts";
import { ODT_WORKFLOW_READ_TOOL_NAMES } from "./odt-workflow-tools";

export type OdtToolAliasResolver = (canonicalToolName: OdtToolName) => readonly string[];

export const ODT_READ_TOOL_NAMES = [
  ODT_WORKSPACE_DISCOVERY_TOOL_NAME,
  "odt_search_tasks",
  ...ODT_WORKFLOW_READ_TOOL_NAMES,
] as const satisfies readonly OdtToolName[];

const ODT_TOOL_NAME_SET = new Set<OdtToolName>(ODT_MCP_TOOL_NAMES);
const ODT_READ_TOOL_NAME_SET = new Set<OdtToolName>(ODT_READ_TOOL_NAMES);

export const normalizeOdtToolName = (
  toolName: string,
  aliasesForTool?: OdtToolAliasResolver,
): OdtToolName | null => {
  const trimmedToolName = toolName.trim();
  if (ODT_TOOL_NAME_SET.has(trimmedToolName as OdtToolName)) {
    return trimmedToolName as OdtToolName;
  }
  if (!aliasesForTool) {
    return null;
  }
  for (const canonicalToolName of ODT_MCP_TOOL_NAMES) {
    if (aliasesForTool(canonicalToolName).includes(trimmedToolName)) {
      return canonicalToolName;
    }
  }
  return null;
};

export const isOdtMutationToolName = (
  toolName: string,
  aliasesForTool?: OdtToolAliasResolver,
): boolean => {
  const normalized = normalizeOdtToolName(toolName, aliasesForTool);
  return normalized !== null && !ODT_READ_TOOL_NAME_SET.has(normalized);
};
