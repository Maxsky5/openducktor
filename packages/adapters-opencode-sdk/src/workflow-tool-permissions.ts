import {
  ODT_MCP_TOOL_NAMES,
  OPENCODE_ODT_TOOL_ID_PREFIXES,
  type RuntimeDescriptor,
  toOpencodeExposedOdtToolIds,
} from "@openducktor/contracts";
import {
  AGENT_ROLE_TOOL_POLICY,
  type AgentRole,
  isReadOnlyAgentRole,
  ODT_WORKFLOW_TOOL_NAMES,
} from "@openducktor/core";

type PermissionAction = "allow" | "deny" | "ask";

export type OpencodePermissionRule = {
  permission: string;
  pattern: string;
  action: PermissionAction;
};

export const buildRoleScopedPermissionRules = (input: {
  role: AgentRole;
  runtimeDescriptor: RuntimeDescriptor;
}): OpencodePermissionRule[] => buildScopePermissionRules(input);

export const buildRepositoryScopedPermissionRules = (
  runtimeDescriptor: RuntimeDescriptor,
): OpencodePermissionRule[] =>
  buildScopePermissionRules({
    role: null,
    runtimeDescriptor,
  });

const buildScopePermissionRules = (input: {
  role: AgentRole | null;
  runtimeDescriptor: RuntimeDescriptor;
}): OpencodePermissionRule[] => {
  const { role, runtimeDescriptor } = input;
  const allowedTools = new Set(role ? AGENT_ROLE_TOOL_POLICY[role] : []);
  const rules: OpencodePermissionRule[] = [];

  if (role && isReadOnlyAgentRole(role)) {
    for (const toolId of new Set(["edit", ...runtimeDescriptor.readOnlyRoleBlockedTools])) {
      rules.push({
        permission: toolId,
        pattern: "*",
        action: "deny",
      });
    }
  }

  rules.push(...buildToolRules(runtimeDescriptor, role));

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

const buildToolRules = (
  runtimeDescriptor: RuntimeDescriptor,
  role: AgentRole | null,
): OpencodePermissionRule[] => {
  const actions = new Map<string, PermissionAction>();
  if (role !== null) {
    actions.set("subagent", "deny");
  }

  actions.set("odt_*", "deny");
  for (const prefix of OPENCODE_ODT_TOOL_ID_PREFIXES) {
    actions.set(`${prefix}*`, "deny");
  }
  const action = role === null ? "allow" : "deny";
  for (const toolName of ODT_MCP_TOOL_NAMES) {
    for (const permission of toOpencodeExposedOdtToolIds(toolName)) {
      actions.set(permission, action);
    }
  }
  for (const toolName of ODT_WORKFLOW_TOOL_NAMES) {
    actions.set(toolName, action);
    for (const alias of runtimeDescriptor.workflowToolAliasesByCanonical[toolName] ?? []) {
      actions.set(alias, action);
    }
  }

  return Array.from(actions, ([permission, action]) => ({ permission, pattern: "*", action }));
};
