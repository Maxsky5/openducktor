import type { AgentSessionHistoryMessage, LoadAgentSessionHistoryInput } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import {
  type AgentSessionTranscriptState,
  deriveRuntimeTranscriptState,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import { sessionHistoryQueryOptions } from "@/state/queries/agent-session-runtime";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "../agent-chat.types";
import { toAgentChatThreadSession } from "../agent-chat-thread-session";
import { createReadonlyTranscriptSession } from "./readonly-transcript-session";
import { errorMessageFromUnknown } from "./runtime-transcript-error";
import { resolveRuntimeTranscriptHistoryTarget } from "./runtime-transcript-history-target";

type ReadSessionHistory = (
  session: LoadAgentSessionHistoryInput,
) => Promise<AgentSessionHistoryMessage[]>;

type UseRuntimeTranscriptSessionHistoryArgs = {
  isOpen: boolean;
  repoPath: string | null;
  target: AgentSessionIdentity | null;
  repoReadinessState: RepoRuntimeReadinessState;
  liveSession: AgentSessionState | null;
  readSessionHistory: ReadSessionHistory;
};

type RuntimeTranscriptSessionHistory = {
  session: AgentChatThreadSession | null;
  transcriptState: AgentSessionTranscriptState;
  historyError: string | null;
};

export function useRuntimeTranscriptSessionHistory({
  isOpen,
  repoPath,
  target,
  repoReadinessState,
  liveSession,
  readSessionHistory,
}: UseRuntimeTranscriptSessionHistoryArgs): RuntimeTranscriptSessionHistory {
  const historyTarget = useMemo(
    () =>
      resolveRuntimeTranscriptHistoryTarget({
        isOpen,
        repoPath,
        target,
        liveSession,
      }),
    [isOpen, liveSession, repoPath, target],
  );
  const historySessionRef = historyTarget.kind === "history" ? historyTarget.sessionRef : null;

  const historyQuery = useQuery({
    ...sessionHistoryQueryOptions(historySessionRef, readSessionHistory),
    enabled: historyTarget.kind === "history" && repoReadinessState === "ready",
  });

  const session = useMemo(() => {
    if (historyTarget.kind === "live") {
      return toAgentChatThreadSession(historyTarget.session, []);
    }
    if (historyTarget.kind !== "history" || !historyQuery.data) {
      return null;
    }

    return createReadonlyTranscriptSession({
      externalSessionId: historyTarget.sessionRef.externalSessionId,
      runtimeKind: historyTarget.sessionRef.runtimeKind,
      workingDirectory: historyTarget.sessionRef.workingDirectory,
      history: historyQuery.data,
    });
  }, [historyQuery.data, historyTarget]);
  const transcriptState = useMemo(() => {
    return deriveRuntimeTranscriptState({
      hasVisibleTranscript: session !== null,
      hasHistoryTarget: historyTarget.kind === "history",
      hasHistoryFailed: historyQuery.error != null,
      repoReadinessState,
    });
  }, [historyQuery.error, historyTarget, repoReadinessState, session]);

  return {
    session,
    transcriptState,
    historyError: historyQuery.error
      ? errorMessageFromUnknown(historyQuery.error, "Failed to load transcript history.")
      : null,
  };
}
