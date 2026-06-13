import type { AgentSessionState } from "@/types/agent-orchestrator";

export type AgentChatThreadLifecycle = {
  canRenderHistory: boolean;
  isViewSwitching: boolean;
};

type ResolveAgentChatThreadContextArgs = {
  activeSession: AgentSessionState | null;
  lifecycle: AgentChatThreadLifecycle;
};

export type AgentChatThreadContext = {
  threadSession: AgentSessionState | null;
  activeExternalSessionId: string | null;
  isContextSwitching: boolean;
};

export const resolveAgentChatThreadContext = ({
  activeSession,
  lifecycle,
}: ResolveAgentChatThreadContextArgs): AgentChatThreadContext => {
  const activeExternalSessionId = activeSession?.externalSessionId ?? null;
  const shouldClearThread = lifecycle.isViewSwitching && !lifecycle.canRenderHistory;

  return {
    threadSession: shouldClearThread ? null : activeSession,
    activeExternalSessionId: shouldClearThread ? null : activeExternalSessionId,
    isContextSwitching: shouldClearThread,
  };
};
