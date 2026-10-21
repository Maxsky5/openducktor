import {
  isOdtBrowserToolName,
  ODT_MCP_TOOL_NAMES,
  ODT_READ_ONLY_TOOL_NAMES,
  ODT_WORKSPACE_DISCOVERY_TOOL_NAME,
  odtToolNameSchema,
  type OdtToolName,
} from "@openducktor/contracts";
import type { AgentApprovalMutation } from "../types/agent-orchestrator";
import { ODT_WORKFLOW_READ_TOOL_NAMES } from "./odt-workflow-tools";

export type OdtToolAliasResolver = (canonicalToolName: OdtToolName) => readonly string[];

export const ODT_READ_TOOL_NAMES = [
  ODT_WORKSPACE_DISCOVERY_TOOL_NAME,
  ...ODT_WORKFLOW_READ_TOOL_NAMES,
] as const satisfies readonly OdtToolName[];

const ODT_READ_ONLY_TOOL_NAME_SET = new Set<OdtToolName>(ODT_READ_ONLY_TOOL_NAMES);

export const normalizeOdtToolName = (
  toolName: string,
  aliasesForTool?: OdtToolAliasResolver,
): OdtToolName | null => {
  const trimmedToolName = toolName.trim();
  const parsedToolName = odtToolNameSchema.safeParse(trimmedToolName);
  if (parsedToolName.success) {
    return parsedToolName.data;
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

/**
 * Classifies an approval request for an ODT tool. Task and page reads are read-only. Task and
 * workflow writes are mutating. Browser actions never change the workspace or the task store, but
 * they can change the app behind the page, so their class is unknown. Returns null for a tool
 * that is not an ODT tool.
 */
export const classifyOdtToolMutation = (
  toolName: string,
  aliasesForTool?: OdtToolAliasResolver,
): AgentApprovalMutation | null => {
  const normalized = normalizeOdtToolName(toolName, aliasesForTool);
  if (normalized === null) {
    return null;
  }
  if (ODT_READ_ONLY_TOOL_NAME_SET.has(normalized)) {
    return "read_only";
  }
  return isOdtBrowserToolName(normalized) ? "unknown" : "mutating";
};
