import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentSessionScope } from "@openducktor/core";
import { formatWorkflowAgentSessionTitle } from "@openducktor/core";
import {
  buildRepositoryScopedPermissionRules,
  buildRoleScopedPermissionRules,
  type OpencodePermissionRule,
} from "./workflow-tool-permissions";

export const OPENCODE_REPOSITORY_SESSION_TITLE = "Repository session";

export type OpencodeSessionPolicy = {
  sessionScope: AgentSessionScope;
  title: string;
  activityLabel: string;
  permission: OpencodePermissionRule[];
  toolSelection:
    | { kind: "workflow"; role: Extract<AgentSessionScope, { kind: "workflow" }>["role"] }
    | { kind: "repository" };
};

export const resolveOpencodeSessionPolicy = (
  sessionScope: AgentSessionScope | null | undefined,
  runtimeDescriptor: RuntimeDescriptor,
  action: string,
): OpencodeSessionPolicy => {
  if (!sessionScope) {
    throw new Error(`Cannot ${action} without session context.`);
  }
  if (sessionScope.kind === "workflow") {
    return {
      sessionScope,
      title: formatWorkflowAgentSessionTitle(sessionScope.role, sessionScope.taskId),
      activityLabel: sessionScope.role,
      permission: buildRoleScopedPermissionRules({
        role: sessionScope.role,
        runtimeDescriptor,
      }),
      toolSelection: { kind: "workflow", role: sessionScope.role },
    };
  }
  return {
    sessionScope,
    title: OPENCODE_REPOSITORY_SESSION_TITLE,
    activityLabel: "repository",
    permission: buildRepositoryScopedPermissionRules(runtimeDescriptor),
    toolSelection: { kind: "repository" },
  };
};

export const opencodeSessionScopeKindsMatch = (
  left: AgentSessionScope,
  right: AgentSessionScope,
): boolean => {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "repository") {
    return true;
  }
  return right.kind === "workflow" && left.taskId === right.taskId && left.role === right.role;
};

export const describeOpencodeSessionScope = (scope: AgentSessionScope): string =>
  scope.kind === "repository"
    ? "repository scope"
    : `workflow scope for task '${scope.taskId}' and role '${scope.role}'`;
