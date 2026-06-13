import type { AgentSessionState } from "@/types/agent-orchestrator";

export type AgentChatThreadLifecycle = {
  canRenderHistory: boolean;
  isTaskViewResolving: boolean;
  isSessionSelectionResolving: boolean;
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
  const isResolvingSelection =
    lifecycle.isTaskViewResolving || lifecycle.isSessionSelectionResolving;
  const shouldClearThread = isResolvingSelection && !lifecycle.canRenderHistory;

  return {
    threadSession: shouldClearThread ? null : activeSession,
    activeExternalSessionId: shouldClearThread ? null : activeExternalSessionId,
    isContextSwitching: shouldClearThread,
  };
};
