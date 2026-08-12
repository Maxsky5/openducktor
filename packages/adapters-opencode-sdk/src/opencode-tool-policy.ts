import {
  ODT_MCP_TOOL_NAMES,
  OPENCODE_ODT_TOOL_ID_PREFIXES,
  type RuntimeDescriptor,
  toOpencodeExposedOdtToolIds,
} from "@openducktor/contracts";
import { ODT_WORKFLOW_TOOL_NAMES } from "@openducktor/core";

export type OpencodeToolPolicyEntry = {
  toolId: string;
  enabled: boolean;
};

export const OPENCODE_SUBAGENT_TOOL_NAME = "task";
export const OPENCODE_UNSUPPORTED_SUBAGENT_TOOL_NAMES = ["subtask"] as const;

export const resolveOpencodeBaseToolPolicy = (
  runtimeDescriptor: RuntimeDescriptor,
): OpencodeToolPolicyEntry[] => {
  const enabledByToolId = new Map<string, boolean>();

  if (runtimeDescriptor.capabilities.optionalSurfaces.supportsSubagents) {
    enabledByToolId.set(OPENCODE_SUBAGENT_TOOL_NAME, true);
    for (const toolId of OPENCODE_UNSUPPORTED_SUBAGENT_TOOL_NAMES) {
      enabledByToolId.set(toolId, false);
    }
  }

  for (const prefix of OPENCODE_ODT_TOOL_ID_PREFIXES) {
    enabledByToolId.set(`${prefix}*`, false);
  }
  for (const toolName of ODT_MCP_TOOL_NAMES) {
    for (const toolId of toOpencodeExposedOdtToolIds(toolName)) {
      enabledByToolId.set(toolId, false);
    }
  }
  for (const toolName of ODT_WORKFLOW_TOOL_NAMES) {
    enabledByToolId.set(toolName, false);
    for (const alias of runtimeDescriptor.workflowToolAliasesByCanonical[toolName] ?? []) {
      enabledByToolId.set(alias, false);
    }
  }

  return Array.from(enabledByToolId, ([toolId, enabled]) => ({ toolId, enabled }));
};
