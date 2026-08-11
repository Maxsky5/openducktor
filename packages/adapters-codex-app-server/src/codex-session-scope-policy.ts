import type { CodexEffectivePolicy } from "@openducktor/contracts";
import type { AgentSessionRuntimePolicy, AgentSessionScope } from "@openducktor/core";
import { formatWorkflowAgentSessionTitle } from "@openducktor/core";
import { requireCodexRuntimePolicy } from "./codex-session-policy";

export const CODEX_REPOSITORY_SESSION_TITLE = "Repository session";

export type CodexSessionScopePolicy = {
  sessionScope: AgentSessionScope;
  title: string;
  runtimePolicy: CodexEffectivePolicy;
  threadConfig?: Record<string, unknown>;
};

const REPOSITORY_THREAD_CONFIG = {
  "mcp_servers.openducktor.enabled": false,
} as const;

export const resolveCodexSessionScopePolicy = (
  sessionScope: AgentSessionScope | null | undefined,
  runtimePolicy: AgentSessionRuntimePolicy | undefined,
  action: string,
): CodexSessionScopePolicy => {
  if (!sessionScope) {
    throw new Error(`Cannot ${action} without session context.`);
  }
  const policy = requireCodexRuntimePolicy(runtimePolicy, action);
  if (sessionScope.kind === "repository") {
    return {
      sessionScope,
      title: CODEX_REPOSITORY_SESSION_TITLE,
      runtimePolicy: policy,
      threadConfig: REPOSITORY_THREAD_CONFIG,
    };
  }
  return {
    sessionScope,
    title: formatWorkflowAgentSessionTitle(sessionScope.role, sessionScope.taskId),
    runtimePolicy: policy,
  };
};

export const codexSessionScopeKindsMatch = (
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

export const describeCodexSessionScope = (scope: AgentSessionScope): string =>
  scope.kind === "repository"
    ? "repository scope"
    : `workflow scope for task '${scope.taskId}' and role '${scope.role}'`;
