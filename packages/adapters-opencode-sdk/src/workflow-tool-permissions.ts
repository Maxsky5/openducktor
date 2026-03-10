import type { RuntimeDescriptor } from "@openducktor/contracts";
import { AGENT_ROLE_TOOL_POLICY, type AgentRole, ODT_WORKFLOW_TOOL_NAMES } from "@openducktor/core";

type PermissionAction = "allow" | "deny" | "ask";

export type OpencodePermissionRule = {
  permission: string;
  pattern: string;
  action: PermissionAction;
};

const ODT_WORKFLOW_PERMISSION_WILDCARD = "openducktor_odt_*";
const isReadOnlyRole = (role: AgentRole): boolean =>
  role === "spec" || role === "planner" || role === "qa";

export const buildRoleScopedPermissionRules = (input: {
  role: AgentRole;
  runtimeDescriptor: RuntimeDescriptor;
}): OpencodePermissionRule[] => {
  const { role, runtimeDescriptor } = input;
  const allowedTools = new Set(AGENT_ROLE_TOOL_POLICY[role]);
  const rules: OpencodePermissionRule[] = [];

  if (isReadOnlyRole(role)) {
    // OpenCode's umbrella edit permission governs edit/write/patch-style file mutations.
    rules.push({
      permission: "edit",
      pattern: "*",
      action: "deny",
    });

    for (const toolId of new Set(runtimeDescriptor.readOnlyRoleBlockedTools)) {
      if (toolId === "edit") {
        continue;
      }
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
