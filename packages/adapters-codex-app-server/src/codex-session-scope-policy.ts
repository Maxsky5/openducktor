import type { CodexEffectivePolicy } from "@openducktor/contracts";
import type { AgentSessionRuntimePolicy, AgentSessionScope } from "@openducktor/core";
import { formatWorkflowAgentSessionTitle } from "@openducktor/core";
import { requireCodexRuntimePolicy } from "./codex-session-policy";

export const CODEX_REPOSITORY_SESSION_TITLE = "Repository session";

export type CodexSessionScopePolicy = {
  sessionScope: AgentSessionScope;
  title: string;
  runtimePolicy: CodexEffectivePolicy;
};

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
): boolean => left.kind === right.kind;
