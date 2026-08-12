import type { CodexEffectivePolicy } from "@openducktor/contracts";
import type { AgentSessionRuntimePolicy, AgentSessionScope } from "@openducktor/core";
import { formatAgentSessionTitle } from "@openducktor/core";
import { requireCodexRuntimePolicy } from "./codex-session-policy";

type CodexSessionScopePolicyBase = {
  title: string;
  runtimePolicy: CodexEffectivePolicy;
};

export type CodexSessionScopePolicy =
  | (CodexSessionScopePolicyBase & {
      kind: "workflow";
      sessionScope: Extract<AgentSessionScope, { kind: "workflow" }>;
    })
  | (CodexSessionScopePolicyBase & {
      kind: "repository";
      sessionScope: Extract<AgentSessionScope, { kind: "repository" }>;
      threadConfig: typeof REPOSITORY_THREAD_CONFIG;
    });

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
      kind: "repository",
      sessionScope,
      title: formatAgentSessionTitle(sessionScope),
      runtimePolicy: policy,
      threadConfig: REPOSITORY_THREAD_CONFIG,
    };
  }
  return {
    kind: "workflow",
    sessionScope,
    title: formatAgentSessionTitle(sessionScope),
    runtimePolicy: policy,
  };
};
