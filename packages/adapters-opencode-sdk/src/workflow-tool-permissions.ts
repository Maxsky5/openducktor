import {
  ODT_MCP_TOOL_NAMES,
  type RuntimeDescriptor,
  toOpencodeExposedOdtToolIds,
} from "@openducktor/contracts";
import {
  AGENT_ROLE_TOOL_POLICY,
  type AgentRole,
  isReadOnlyAgentRole,
  ODT_WORKFLOW_TOOL_NAMES,
} from "@openducktor/core";
import { resolveOpencodeBaseToolPolicy } from "./opencode-tool-policy";

type PermissionAction = "allow" | "deny" | "ask";

export type OpencodePermissionRule = {
  permission: string;
  pattern: string;
  action: PermissionAction;
};

const buildScopePermissionRules = (input: {
  role: AgentRole | null;
  runtimeDescriptor: RuntimeDescriptor;
}): OpencodePermissionRule[] => {
  const { role, runtimeDescriptor } = input;
  const allowedTools = new Set(role ? AGENT_ROLE_TOOL_POLICY[role] : []);
  const rules: OpencodePermissionRule[] = [];
  const repositoryOdtToolIds = new Set([
    ...ODT_MCP_TOOL_NAMES.flatMap(toOpencodeExposedOdtToolIds),
    ...ODT_WORKFLOW_TOOL_NAMES.flatMap(
      (toolName) => runtimeDescriptor.workflowToolAliasesByCanonical[toolName] ?? [],
    ),
  ]);

  if (role && isReadOnlyAgentRole(role)) {
    for (const toolId of new Set(runtimeDescriptor.readOnlyRoleBlockedTools)) {
      rules.push({
        permission: toolId,
        pattern: "*",
        action: "deny",
      });
    }
  }

  for (const entry of resolveOpencodeBaseToolPolicy({
    runtimeDescriptor,
    enableOdtTools: role === null,
  })) {
    let action: PermissionAction = "deny";
    if (entry.enabled) {
      action = repositoryOdtToolIds.has(entry.toolId) ? "ask" : "allow";
    }
    rules.push({
      permission: entry.toolId,
      pattern: "*",
      action,
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
