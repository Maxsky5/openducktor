import { useEffect, useMemo } from "react";
import { matchesAgentSessionIdentity, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
import { useAgentOperations } from "@/state/app-state-provider";
import { runOrchestratorSideEffect } from "@/state/operations/agent-orchestrator/support/async-side-effects";
import {
  type AgentSessionTranscriptEmptyReason,
  type AgentSessionTranscriptState,
  deriveRuntimeBoundTranscriptLoadingState,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import type { AgentChatThreadSession } from "../agent-chat.types";
import { toAgentChatThreadSession } from "../agent-chat-thread-session";
import type { AgentSessionTranscriptTarget } from "../agent-session-transcript-target";

type UseRuntimeTranscriptSessionHistoryArgs = {
  isOpen: boolean;
  repoPath: string | null;
  target: AgentSessionTranscriptTarget | null;
  repoReadinessState: RepoRuntimeReadinessState;
  liveSession: AgentSessionState | null;
};

type RuntimeTranscriptSessionHistory = {
  session: AgentChatThreadSession | null;
  interactionSession: AgentSessionState | null;
  transcriptState: AgentSessionTranscriptState;
  replyAgentApproval: AgentOperationsContextValue["replyAgentApproval"];
  answerAgentQuestion: AgentOperationsContextValue["answerAgentQuestion"];
};

export function useRuntimeTranscriptSessionHistory({
  isOpen,
  repoPath,
  target,
  repoReadinessState,
  liveSession,
}: UseRuntimeTranscriptSessionHistoryArgs): RuntimeTranscriptSessionHistory {
  const { loadAgentSessionHistory, replyAgentApproval, answerAgentQuestion } = useAgentOperations();
  const matchingSession =
    isOpen &&
    target !== null &&
    liveSession !== null &&
    matchesAgentSessionIdentity(liveSession, target)
      ? liveSession
      : null;
  const historyTarget =
    matchingSession !== null &&
    matchingSession.historyLoadState !== "loaded" &&
    matchingSession.historyLoadState !== "loading" &&
    repoReadinessState === "ready"
      ? toAgentSessionIdentity(matchingSession)
      : null;
  const stableHistoryTarget = useStableAgentSessionIdentity(historyTarget);

  useEffect(() => {
    if (stableHistoryTarget === null) {
      return;
    }
    runOrchestratorSideEffect(
      "runtime-transcript-history-load",
      loadAgentSessionHistory(stableHistoryTarget),
      { tags: stableHistoryTarget },
    );
  }, [loadAgentSessionHistory, stableHistoryTarget]);

  const session = useMemo(
    () => (matchingSession ? toAgentChatThreadSession(matchingSession) : null),
    [matchingSession],
  );
  let emptyReason: AgentSessionTranscriptEmptyReason | null = null;
  if (!isOpen) {
    emptyReason = "inactive";
  } else if (repoPath === null || target === null) {
    emptyReason = "unavailable";
  }
  const transcriptState = useMemo<AgentSessionTranscriptState>(() => {
    if (session !== null) {
      return { kind: "visible" };
    }
    if (emptyReason !== null) {
      return { kind: "empty", reason: emptyReason };
    }
    return deriveRuntimeBoundTranscriptLoadingState({
      reason: "history",
      repoReadinessState,
    });
  }, [emptyReason, repoReadinessState, session]);

  return {
    session,
    interactionSession: matchingSession,
    transcriptState,
    replyAgentApproval,
    answerAgentQuestion,
  };
}
