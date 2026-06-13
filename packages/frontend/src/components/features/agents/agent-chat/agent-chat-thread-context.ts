import type { AgentChatThreadSession } from "./agent-chat.types";

export type AgentChatThreadLifecycle = {
  canRenderHistory: boolean;
  isViewSwitching: boolean;
};

type ResolveAgentChatThreadContextArgs = {
  activeSession: AgentChatThreadSession | null;
  lifecycle: AgentChatThreadLifecycle;
};

export type AgentChatThreadContext = {
  threadSession: AgentChatThreadSession | null;
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
