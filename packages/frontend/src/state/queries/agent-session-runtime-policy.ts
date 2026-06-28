import type { SettingsSnapshot } from "@openducktor/contracts";
import type { AgentSessionScope, RuntimeKind } from "@openducktor/core";
import { resolveAgentSessionRuntimePolicy } from "../operations/agent-orchestrator/support/session-runtime-policy";

export const AGENT_SESSION_RUNTIME_POLICY_STALE_TIME_MS = 15 * 60_000;

export const agentSessionRuntimePolicyQueryKeys = {
  all: ["agent-session-runtime-policy"] as const,
  policy: (runtimeKind: RuntimeKind, sessionScope: AgentSessionScope) =>
    [
      "agent-session-runtime-policy",
      runtimeKind,
      sessionScope.kind,
      sessionScope.taskId,
      sessionScope.role,
    ] as const,
};

export const agentSessionRuntimePolicyQueryOptions = ({
  runtimeKind,
  sessionScope,
  loadSettingsSnapshot,
}: {
  runtimeKind: RuntimeKind;
  sessionScope: AgentSessionScope;
  loadSettingsSnapshot: () => Promise<SettingsSnapshot>;
}) => ({
  queryKey: agentSessionRuntimePolicyQueryKeys.policy(runtimeKind, sessionScope),
  queryFn: () =>
    resolveAgentSessionRuntimePolicy({ runtimeKind, sessionScope, loadSettingsSnapshot }),
  staleTime: AGENT_SESSION_RUNTIME_POLICY_STALE_TIME_MS,
});
