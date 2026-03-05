import { AGENT_ROLE_TOOL_POLICY, type AgentRole, ODT_WORKFLOW_TOOL_NAMES } from "@openducktor/core";

type PermissionAction = "allow" | "deny" | "ask";

export type OpencodePermissionRule = {
  permission: string;
  pattern: string;
  action: PermissionAction;
};

const ODT_WORKFLOW_PERMISSION_WILDCARD = "openducktor_odt_*";

export const buildRoleScopedOdtPermissionRules = (role: AgentRole): OpencodePermissionRule[] => {
  const allowedTools = new Set(AGENT_ROLE_TOOL_POLICY[role]);

  // OpenCode permission checks normalize MCP tool IDs to openducktor_odt_*.
  // Keep a single namespace to avoid redundant aliases and drift.
  const rules: OpencodePermissionRule[] = [
    {
      permission: ODT_WORKFLOW_PERMISSION_WILDCARD,
      pattern: "*",
      action: "deny",
    },
  ];

  for (const toolName of ODT_WORKFLOW_TOOL_NAMES) {
    if (!allowedTools.has(toolName)) {
      continue;
    }
    rules.push({
      permission: `openducktor_${toolName}`,
      pattern: "*",
      action: "allow",
    });
  }

  return rules;
};
