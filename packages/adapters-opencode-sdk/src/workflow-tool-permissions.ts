import {
  ODT_MCP_TOOL_NAMES,
  OPENCODE_ODT_TOOL_ID_PREFIXES,
  type RuntimeDescriptor,
  toOpencodeExposedOdtToolIds,
} from "@openducktor/contracts";
import { ODT_WORKFLOW_TOOL_NAMES, type WorkflowRolePolicy } from "@openducktor/core";

type PermissionAction = "allow" | "deny" | "ask";

export type OpencodePermissionRule = {
  permission: string;
  pattern: string;
  action: PermissionAction;
};

export const buildRoleScopedPermissionRules = (input: {
  rolePolicy: WorkflowRolePolicy;
  runtimeDescriptor: RuntimeDescriptor;
}): OpencodePermissionRule[] => buildScopePermissionRules(input);

export const buildRepositoryScopedPermissionRules = (
  runtimeDescriptor: RuntimeDescriptor,
): OpencodePermissionRule[] =>
  buildScopePermissionRules({
    rolePolicy: null,
    runtimeDescriptor,
  });

const buildScopePermissionRules = (input: {
  rolePolicy: WorkflowRolePolicy | null;
  runtimeDescriptor: RuntimeDescriptor;
}): OpencodePermissionRule[] => {
  const { rolePolicy, runtimeDescriptor } = input;
  const allowedTools = new Set<string>(rolePolicy?.tools ?? []);
  const rules: OpencodePermissionRule[] = [];

  if (rolePolicy?.readOnly) {
    for (const toolId of new Set(["edit", ...runtimeDescriptor.readOnlyRoleBlockedTools])) {
      rules.push({
        permission: toolId,
        pattern: "*",
        action: "deny",
      });
    }
  }

  rules.push(...buildToolRules(runtimeDescriptor, rolePolicy === null));

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

/** A repository session allows every ODT tool. A workflow session allows only the tools of its role. */
const buildToolRules = (
  runtimeDescriptor: RuntimeDescriptor,
  repositoryScope: boolean,
): OpencodePermissionRule[] => {
  const actions = new Map<string, PermissionAction>();
  actions.set("odt_*", "deny");
  for (const prefix of OPENCODE_ODT_TOOL_ID_PREFIXES) {
    actions.set(`${prefix}*`, "deny");
  }
  const action = repositoryScope ? "allow" : "deny";
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
