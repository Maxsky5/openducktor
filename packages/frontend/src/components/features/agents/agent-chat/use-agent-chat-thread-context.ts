import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseAgentChatThreadContextArgs = {
  activeSession: AgentSessionState | null;
  isTaskViewResolving: boolean;
  isSessionSelectionResolving: boolean;
};

type AgentChatThreadContext = {
  threadSession: AgentSessionState | null;
  activeExternalSessionId: string | null;
  isContextSwitching: boolean;
};

export const useAgentChatThreadContext = ({
  activeSession,
  isTaskViewResolving,
  isSessionSelectionResolving,
}: UseAgentChatThreadContextArgs): AgentChatThreadContext => {
  const activeExternalSessionId = activeSession?.externalSessionId ?? null;
  const shouldClearThread = isTaskViewResolving || isSessionSelectionResolving;

  return {
    threadSession: shouldClearThread ? null : activeSession,
    activeExternalSessionId: shouldClearThread ? null : activeExternalSessionId,
    isContextSwitching: shouldClearThread,
  };
};
