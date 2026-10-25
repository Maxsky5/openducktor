import {
  runtimeSupportedScopeValues,
  type CodexEffectivePolicy,
  type CodexPolicyFields,
  type CodexRuntimeConfig,
  resolveCodexEffectivePolicy,
  type RuntimeSupportedScope,
} from "@openducktor/contracts";
import { BUILTIN_ROLES, builtinRole, byRole } from "./definition";
import type { BuiltinRoleId } from "./ids";

/** The ODT tools of each role. */
export const AGENT_ROLE_TOOL_POLICY = byRole((role) => role.tools);

/** Roles whose sessions run in the task worktree. */
export const WORKTREE_AGENT_ROLES: readonly BuiltinRoleId[] = BUILTIN_ROLES.filter(
  (role) => role.location === "task_worktree",
).map((role) => role.id);

export const runtimeRequiredScopesByRole = byRole((role) => role.runtimeScopes);

const requiredRuntimeSupportedScopeSet = new Set<RuntimeSupportedScope>(
  Object.values(runtimeRequiredScopesByRole).flat(),
);

const requiredRuntimeSupportedScopes = runtimeSupportedScopeValues.filter((scope) =>
  requiredRuntimeSupportedScopeSet.has(scope),
);

export const getMissingRequiredRuntimeSupportedScopes = (
  supportedScopes: readonly RuntimeSupportedScope[],
): RuntimeSupportedScope[] => {
  const supportedScopeSet = new Set<RuntimeSupportedScope>(supportedScopes);
  return requiredRuntimeSupportedScopes.filter((scope) => !supportedScopeSet.has(scope));
};

/** Codex policy for a workflow role. Roles that write cannot inherit a read-only sandbox. */
export const resolveCodexRolePolicy = (
  config: CodexRuntimeConfig,
  role: BuiltinRoleId | null,
): CodexEffectivePolicy =>
  resolveCodexEffectivePolicy(config, role, role !== null && !isReadOnlyAgentRole(role));

const isReadOnlyAgentRole = (role: BuiltinRoleId): boolean =>
  builtinRole(role).workspaceAccess === "read";

export const isCodexSandboxModeSelectableForRole = (
  role: BuiltinRoleId,
  value: CodexPolicyFields[keyof CodexPolicyFields],
): boolean => isReadOnlyAgentRole(role) || value !== "read-only";
