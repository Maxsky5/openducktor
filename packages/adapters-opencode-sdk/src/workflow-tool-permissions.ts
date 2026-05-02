import { ODT_MCP_TOOL_NAMES, type RuntimeDescriptor } from "@openducktor/contracts";
import { AGENT_ROLE_TOOL_POLICY, type AgentRole, ODT_WORKFLOW_TOOL_NAMES } from "@openducktor/core";
import { isReadOnlyRole } from "./read-only-roles";

type PermissionAction = "allow" | "deny" | "ask";

export type OpencodePermissionRule = {
  permission: string;
  pattern: string;
  action: PermissionAction;
};

const OPENCODE_EXPOSED_ODT_TOOL_ID_PREFIXES = ["openducktor_", "functions.openducktor_"] as const;
const ODT_MCP_PERMISSION_WILDCARDS = OPENCODE_EXPOSED_ODT_TOOL_ID_PREFIXES.map(
  (prefix) => `${prefix}*`,
);

const addOpenCodeExposedOdtToolPermissions = (permissions: Set<string>, toolName: string): void => {
  permissions.add(toolName);
  for (const prefix of OPENCODE_EXPOSED_ODT_TOOL_ID_PREFIXES) {
    permissions.add(`${prefix}${toolName}`);
  }
};

const buildOdtToolDenyPermissions = (runtimeDescriptor: RuntimeDescriptor): Set<string> => {
  const permissions = new Set<string>();

  for (const toolName of ODT_MCP_TOOL_NAMES) {
    addOpenCodeExposedOdtToolPermissions(permissions, toolName);
  }

  for (const toolName of ODT_WORKFLOW_TOOL_NAMES) {
    for (const alias of runtimeDescriptor.workflowToolAliasesByCanonical[toolName] ?? []) {
      permissions.add(alias);
    }
  }

  return permissions;
};

export const buildRoleScopedPermissionRules = (input: {
  role: AgentRole;
  runtimeDescriptor: RuntimeDescriptor;
}): OpencodePermissionRule[] => {
  const { role, runtimeDescriptor } = input;
  const allowedTools = new Set(AGENT_ROLE_TOOL_POLICY[role]);
  const rules: OpencodePermissionRule[] = [];

  if (isReadOnlyRole(role)) {
    for (const toolId of new Set(runtimeDescriptor.readOnlyRoleBlockedTools)) {
      rules.push({
        permission: toolId,
        pattern: "*",
        action: "deny",
      });
    }
  }

  for (const permission of ODT_MCP_PERMISSION_WILDCARDS) {
    rules.push({
      permission,
      pattern: "*",
      action: "deny",
    });
  }
  for (const permission of buildOdtToolDenyPermissions(runtimeDescriptor)) {
    rules.push({
      permission,
      pattern: "*",
      action: "deny",
    });
  }

  for (const toolName of ODT_WORKFLOW_TOOL_NAMES) {
    if (!allowedTools.has(toolName)) {
      continue;
    }
    for (const permission of new Set([
      toolName,
      ...(runtimeDescriptor.workflowToolAliasesByCanonical[toolName] ?? []),
    ])) {
      rules.push({
        permission,
        pattern: "*",
        action: "allow",
      });
    }
  }

  return rules;
};
