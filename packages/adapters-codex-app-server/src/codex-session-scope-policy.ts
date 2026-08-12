import type { CodexEffectivePolicy } from "@openducktor/contracts";
import type { AgentSessionRuntimePolicy, AgentSessionScope } from "@openducktor/core";
import { formatAgentSessionTitle } from "@openducktor/core";
import { requireCodexRuntimePolicy } from "./codex-session-policy";

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
      title: formatAgentSessionTitle(sessionScope),
      runtimePolicy: policy,
      threadConfig: REPOSITORY_THREAD_CONFIG,
    };
  }
  return {
    sessionScope,
    title: formatAgentSessionTitle(sessionScope),
    runtimePolicy: policy,
  };
};
