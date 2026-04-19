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
  statusOverlay: {
    kind: "runtime_waiting" | "session_loading";
    title: string;
    description: string;
  } | null;
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
  const statusOverlay = (() => {
    if (
      isWaitingForRuntimeReadiness &&
      (readinessState === "checking" || readinessState === "ready")
    ) {
      return {
        kind: "runtime_waiting" as const,
        title:
          readinessState === "ready" ? "Session runtime is reconnecting" : "Runtime is starting",
        description:
          readinessState === "ready"
            ? "Waiting for the selected session runtime to become available before loading this session."
            : "Waiting for runtime and MCP health before loading this session.",
      };
    }

    if (!isTranscriptLoading) {
      return null;
    }

    return {
      kind: "session_loading" as const,
      title: "Loading session",
      description: hideTranscriptWhileHydrating
        ? "Loading the selected session transcript."
        : "Preparing the selected session view.",
    };
  })();

  return {
    isTranscriptLoading,
    hideTranscriptWhileHydrating,
    statusOverlay,
    showRuntimeBlockedCard: readinessState === "blocked" && Boolean(blockedReason),
  };
};
