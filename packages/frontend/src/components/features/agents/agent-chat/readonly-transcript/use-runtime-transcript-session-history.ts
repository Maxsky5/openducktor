import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
import { useAgentOperations } from "@/state/app-state-provider";
import { toRuntimeSessionRef } from "@/state/operations/agent-orchestrator/support/session-runtime-ref";
import {
  type AgentSessionTranscriptEmptyReason,
  type AgentSessionTranscriptState,
  deriveRuntimeBoundTranscriptLoadingState,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import {
  SESSION_HISTORY_STALE_TIME_MS,
  sessionHistoryQueryOptions,
} from "@/state/queries/agent-session-history";
import { skippedQueryOptions } from "@/state/queries/skipped-query";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "../agent-chat.types";
import { toAgentChatThreadSession } from "../agent-chat-thread-session";
import { createReadonlyTranscriptSession } from "./readonly-transcript-session";
import { errorMessageFromUnknown } from "./runtime-transcript-error";
import { useRuntimeTranscriptLiveOverlay } from "./use-runtime-transcript-live-overlay";

type UseRuntimeTranscriptSessionHistoryArgs = {
  isOpen: boolean;
  repoPath: string | null;
  target: AgentSessionIdentity | null;
  repoReadinessState: RepoRuntimeReadinessState;
  liveSession: AgentSessionState | null;
};

type RuntimeTranscriptSessionHistory = {
  session: AgentChatThreadSession | null;
  interactionSession: AgentSessionState | null;
  transcriptState: AgentSessionTranscriptState;
};

const skippedTranscriptHistoryQueryOptions = skippedQueryOptions<AgentSessionHistoryMessage[]>({
  queryKey: ["runtime-transcript-session-history", "skipped"] as const,
  staleTime: SESSION_HISTORY_STALE_TIME_MS,
  refetchOnWindowFocus: false,
});

export function useRuntimeTranscriptSessionHistory({
  isOpen,
  repoPath,
  target,
  repoReadinessState,
  liveSession,
}: UseRuntimeTranscriptSessionHistoryArgs): RuntimeTranscriptSessionHistory {
  const { readSessionHistory, replyAgentApproval, subscribeSessionEvents } = useAgentOperations();
  const stableTarget = useStableAgentSessionIdentity(target);

  const emptyReason: AgentSessionTranscriptEmptyReason | null =
    !isOpen || stableTarget === null ? "inactive" : repoPath ? null : "unavailable";

  const matchingLiveSession =
    emptyReason === null &&
    liveSession !== null &&
    stableTarget !== null &&
    matchesAgentSessionIdentity(liveSession, stableTarget)
      ? liveSession
      : null;
  const shouldLoadHistory = emptyReason === null && matchingLiveSession === null;
  const shouldObserveRuntimeSession =
    shouldLoadHistory &&
    repoPath !== null &&
    stableTarget !== null &&
    repoReadinessState === "ready";

  const historyQuery = useQuery(
    shouldLoadHistory &&
      repoPath !== null &&
      stableTarget !== null &&
      repoReadinessState === "ready"
      ? sessionHistoryQueryOptions(toRuntimeSessionRef(repoPath, stableTarget), readSessionHistory)
      : skippedTranscriptHistoryQueryOptions,
  );
  const liveOverlay = useRuntimeTranscriptLiveOverlay({
    shouldObserve: shouldObserveRuntimeSession,
    repoPath,
    target: stableTarget,
    history: historyQuery.data,
    shouldMergeHistory: shouldLoadHistory,
    replyAgentApproval,
    subscribeSessionEvents,
  });

  const session = useMemo(() => {
    if (matchingLiveSession !== null) {
      return toAgentChatThreadSession(matchingLiveSession);
    }
    if (liveOverlay.hasVisibleRuntimeData && liveOverlay.session !== null) {
      return toAgentChatThreadSession(liveOverlay.session);
    }
    if (!shouldLoadHistory || !historyQuery.data || repoPath === null || stableTarget === null) {
      return null;
    }

    return createReadonlyTranscriptSession({
      ...stableTarget,
      history: historyQuery.data,
    });
  }, [
    historyQuery.data,
    liveOverlay.hasVisibleRuntimeData,
    liveOverlay.session,
    matchingLiveSession,
    repoPath,
    shouldLoadHistory,
    stableTarget,
  ]);
  const interactionSession = matchingLiveSession ?? liveOverlay.interactionSession;
  const transcriptState = useMemo<AgentSessionTranscriptState>(() => {
    if (session !== null) {
      return { kind: "visible" };
    }
    if (emptyReason !== null) {
      return { kind: "empty", reason: emptyReason };
    }
    if (historyQuery.error && repoReadinessState === "ready") {
      return {
        kind: "failed",
        message: errorMessageFromUnknown(historyQuery.error, "Failed to load transcript history."),
      };
    }
    if (liveOverlay.error && repoReadinessState === "ready") {
      return {
        kind: "failed",
        message: liveOverlay.error,
      };
    }
    return deriveRuntimeBoundTranscriptLoadingState({
      reason: "history",
      repoReadinessState,
    });
  }, [emptyReason, historyQuery.error, liveOverlay.error, repoReadinessState, session]);

  return {
    session,
    interactionSession,
    transcriptState,
  };
}
