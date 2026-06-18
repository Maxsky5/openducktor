import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { matchesAgentSessionIdentity, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import { useAgentOperations } from "@/state/app-state-provider";
import { toRuntimeSessionRef } from "@/state/operations/agent-orchestrator/support/session-runtime-ref";
import {
  type AgentSessionTranscriptEmptyReason,
  type AgentSessionTranscriptState,
  deriveRuntimeTranscriptState,
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

type UseRuntimeTranscriptSessionHistoryArgs = {
  isOpen: boolean;
  repoPath: string | null;
  target: AgentSessionIdentity | null;
  repoReadinessState: RepoRuntimeReadinessState;
  liveSession: AgentSessionState | null;
};

type RuntimeTranscriptSessionHistory = {
  session: AgentChatThreadSession | null;
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
  const { readSessionHistory } = useAgentOperations();
  const matchedLiveSession =
    target && matchesAgentSessionIdentity(liveSession, target) ? liveSession : null;
  let emptyReason: AgentSessionTranscriptEmptyReason | null = null;
  if (!isOpen || !target) {
    emptyReason = "inactive";
  } else if (!repoPath) {
    emptyReason = "unavailable";
  }
  const historySessionRef = useMemo(
    () =>
      isOpen && target && repoPath && !matchedLiveSession
        ? toRuntimeSessionRef(repoPath, target)
        : null,
    [isOpen, matchedLiveSession, repoPath, target],
  );

  const historyQuery = useQuery(
    historySessionRef && repoReadinessState === "ready"
      ? sessionHistoryQueryOptions(historySessionRef, readSessionHistory)
      : skippedTranscriptHistoryQueryOptions,
  );

  const session = useMemo(() => {
    if (matchedLiveSession) {
      return toAgentChatThreadSession(matchedLiveSession);
    }
    if (!historySessionRef || !historyQuery.data) {
      return null;
    }

    return createReadonlyTranscriptSession({
      ...toAgentSessionIdentity(historySessionRef),
      history: historyQuery.data,
    });
  }, [historyQuery.data, historySessionRef, matchedLiveSession]);
  const historyFailureMessage = historyQuery.error
    ? errorMessageFromUnknown(historyQuery.error, "Failed to load transcript history.")
    : null;
  const transcriptState = useMemo(() => {
    return deriveRuntimeTranscriptState({
      hasVisibleTranscript: session !== null,
      hasHistoryTarget: historySessionRef !== null,
      historyFailureMessage,
      repoReadinessState,
      ...(emptyReason ? { emptyReason } : {}),
    });
  }, [emptyReason, historyFailureMessage, historySessionRef, repoReadinessState, session]);

  return {
    session,
    transcriptState,
  };
}
