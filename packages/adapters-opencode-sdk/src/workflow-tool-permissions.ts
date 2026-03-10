import type { RuntimeDescriptor } from "@openducktor/contracts";
import { AGENT_ROLE_TOOL_POLICY, type AgentRole, ODT_WORKFLOW_TOOL_NAMES } from "@openducktor/core";
import { isReadOnlyRole } from "./read-only-roles";

type PermissionAction = "allow" | "deny" | "ask";

export type OpencodePermissionRule = {
  permission: string;
  pattern: string;
  action: PermissionAction;
};

const ODT_WORKFLOW_PERMISSION_WILDCARD = "openducktor_odt_*";

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

  rules.push({
    permission: ODT_WORKFLOW_PERMISSION_WILDCARD,
    pattern: "*",
    action: "deny",
  });

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
