import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseAgentChatThreadContextArgs = {
  activeSession: AgentSessionState | null;
  isTaskHydrating: boolean;
  isSessionSelectionResolving: boolean;
};

type AgentChatThreadContext = {
  threadSession: AgentSessionState | null;
  activeExternalSessionId: string | null;
  isContextSwitching: boolean;
};

export const useAgentChatThreadContext = ({
  activeSession,
  isTaskHydrating,
  isSessionSelectionResolving,
}: UseAgentChatThreadContextArgs): AgentChatThreadContext => {
  const activeExternalSessionId = activeSession?.externalSessionId ?? null;
  const shouldClearThread = isTaskHydrating || isSessionSelectionResolving;

  return {
    threadSession: shouldClearThread ? null : activeSession,
    activeExternalSessionId: shouldClearThread ? null : activeExternalSessionId,
    isContextSwitching: shouldClearThread,
  };
};
