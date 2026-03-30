import type { AgentChatThreadModel } from "./agent-chat.types";

type BuildAgentChatThreadStateArgs = Pick<
  AgentChatThreadModel,
  | "isSessionViewLoading"
  | "isSessionHistoryLoading"
  | "isWaitingForRuntimeReadiness"
  | "readinessState"
  | "blockedReason"
> & {
  isTranscriptRenderDeferred: boolean;
};

export type AgentChatThreadState = {
  isTranscriptLoading: boolean;
  hideTranscriptWhileHydrating: boolean;
  showRuntimeCheckingOverlay: boolean;
  showRuntimeBlockedCard: boolean;
};

export const getAgentChatThreadState = ({
  isSessionViewLoading,
  isSessionHistoryLoading,
  isWaitingForRuntimeReadiness,
  readinessState,
  blockedReason,
  isTranscriptRenderDeferred,
}: BuildAgentChatThreadStateArgs): AgentChatThreadState => {
  const isTranscriptLoading =
    isSessionViewLoading || isSessionHistoryLoading || isTranscriptRenderDeferred;
  const hideTranscriptWhileHydrating = isSessionHistoryLoading || isTranscriptRenderDeferred;

  return {
    isTranscriptLoading,
    hideTranscriptWhileHydrating,
    showRuntimeCheckingOverlay:
      isWaitingForRuntimeReadiness && (readinessState === "checking" || readinessState === "ready"),
    showRuntimeBlockedCard: readinessState === "blocked" && Boolean(blockedReason),
  };
};
