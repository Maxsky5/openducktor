import { isSelectedAgentSessionWaitingForRuntimeReadiness } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type { AgentChatThreadModel } from "./agent-chat.types";

type BuildAgentChatThreadStateArgs = Pick<
  AgentChatThreadModel,
  "sessionLifecycle" | "runtimeReadiness"
> & {
  isSessionContextSwitching: boolean;
  isTranscriptRenderDeferred: boolean;
  isTranscriptRowsMissing?: boolean;
};

export type AgentChatThreadState = {
  isTranscriptLoading: boolean;
  hideTranscriptWhileDeferred: boolean;
  statusOverlay: {
    kind: "runtime_waiting" | "session_loading";
    title: string;
    description: string;
  } | null;
  showRuntimeBlockedCard: boolean;
};

export const getAgentChatThreadState = ({
  sessionLifecycle,
  runtimeReadiness,
  isSessionContextSwitching,
  isTranscriptRenderDeferred,
  isTranscriptRowsMissing = false,
}: BuildAgentChatThreadStateArgs): AgentChatThreadState => {
  const isWaitingForRuntimeReadiness =
    isSelectedAgentSessionWaitingForRuntimeReadiness(sessionLifecycle) ||
    runtimeReadiness.isRuntimeStarting;
  const isPreparingSessionView =
    isSessionContextSwitching || sessionLifecycle.phase === "resolving_session";
  const isBlockingHistoryLoad =
    sessionLifecycle.phase === "loading_history" && !sessionLifecycle.canRenderHistory;
  const isTranscriptLoading =
    !isWaitingForRuntimeReadiness &&
    (isPreparingSessionView ||
      isBlockingHistoryLoad ||
      isTranscriptRenderDeferred ||
      isTranscriptRowsMissing);
  const hideTranscriptWhileDeferred = isTranscriptRenderDeferred;
  const statusOverlay = (() => {
    if (
      isWaitingForRuntimeReadiness &&
      (runtimeReadiness.readinessState === "checking" ||
        runtimeReadiness.readinessState === "ready")
    ) {
      return {
        kind: "runtime_waiting" as const,
        title:
          runtimeReadiness.readinessState === "ready"
            ? "Session runtime is reconnecting"
            : "Runtime is starting",
        description:
          runtimeReadiness.readinessState === "ready"
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
      description:
        isBlockingHistoryLoad || isTranscriptRenderDeferred || isTranscriptRowsMissing
          ? "Loading the selected conversation."
          : "Preparing the selected session view.",
    };
  })();

  return {
    isTranscriptLoading,
    hideTranscriptWhileDeferred,
    statusOverlay,
    showRuntimeBlockedCard:
      runtimeReadiness.readinessState === "blocked" && Boolean(runtimeReadiness.blockedReason),
  };
};
