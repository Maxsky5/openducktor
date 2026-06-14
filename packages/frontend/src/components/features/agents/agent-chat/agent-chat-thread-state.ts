import { getAgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
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
  hideTranscriptRows: boolean;
  shouldResetTranscriptWindow: boolean;
  transcriptNotice: {
    kind: "runtime_waiting" | "session_loading" | "session_failed" | "runtime_blocked";
    title: string;
    description: string;
  } | null;
};

export const getAgentChatThreadState = ({
  sessionLifecycle,
  runtimeReadiness,
  isSessionContextSwitching,
  isTranscriptRenderDeferred,
  isTranscriptRowsMissing = false,
}: BuildAgentChatThreadStateArgs): AgentChatThreadState => {
  const isRenderLocallyLoading =
    isSessionContextSwitching || isTranscriptRenderDeferred || isTranscriptRowsMissing;
  const hideTranscriptRows = isTranscriptRenderDeferred;
  const transcriptState = getAgentSessionTranscriptState(sessionLifecycle);
  const shouldResetTranscriptWindow =
    isRenderLocallyLoading || transcriptState.kind === "session_loading";
  const transcriptNotice = (() => {
    if (
      transcriptState.kind === "runtime_waiting" &&
      runtimeReadiness.readinessState === "blocked" &&
      runtimeReadiness.blockedReason
    ) {
      return {
        kind: "runtime_blocked" as const,
        title: "Runtime unavailable",
        description: runtimeReadiness.blockedReason,
      };
    }

    if (transcriptState.kind === "runtime_waiting") {
      return {
        kind: "runtime_waiting" as const,
        title: "Runtime is starting",
        description: "Waiting for runtime and MCP health before loading this session.",
      };
    }

    if (transcriptState.kind === "session_loading") {
      return {
        kind: "session_loading" as const,
        title: "Loading session",
        description:
          transcriptState.reason === "history"
            ? "Loading the selected conversation."
            : "Preparing the selected session view.",
      };
    }

    if (transcriptState.kind === "failed") {
      return {
        kind: "session_failed" as const,
        title: "Failed to load session",
        description: "The selected conversation could not be loaded.",
      };
    }

    return null;
  })();

  return {
    hideTranscriptRows,
    shouldResetTranscriptWindow,
    transcriptNotice,
  };
};
