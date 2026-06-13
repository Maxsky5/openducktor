import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  agentSessionRuntimeQueryKeys,
  SESSION_HISTORY_STALE_TIME_MS,
} from "@/state/queries/agent-session-runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { AgentChatThreadSession } from "../agent-chat.types";
import { createReadonlyTranscriptSession } from "./readonly-transcript-session";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import { errorMessageFromUnknown } from "./runtime-transcript-error";

type ReadSessionHistory = (
  repoPath: string,
  runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
  workingDirectory: string,
  externalSessionId: string,
) => Promise<AgentSessionHistoryMessage[]>;

type UseRuntimeTranscriptSessionHistoryArgs = {
  isOpen: boolean;
  activeWorkspace: ActiveWorkspace | null;
  externalSessionId: string | null;
  source: RuntimeSessionTranscriptSource | null;
  liveSession: AgentSessionState | null;
  readSessionHistory: ReadSessionHistory;
};

type RuntimeTranscriptSessionHistory = {
  session: AgentChatThreadSession | null;
  isHistoryLoading: boolean;
  historyError: string | null;
};

const toReadonlyLiveTranscriptSession = (session: AgentSessionState): AgentChatThreadSession => ({
  externalSessionId: session.externalSessionId,
  ...(session.title ? { title: session.title } : {}),
  status: session.status,
  runtimeKind: session.runtimeKind,
  workingDirectory: session.workingDirectory,
  messages: session.messages,
  pendingApprovals: session.pendingApprovals,
  pendingQuestions: session.pendingQuestions,
  selectedModel: session.selectedModel,
  todos: [],
});

export function useRuntimeTranscriptSessionHistory({
  isOpen,
  activeWorkspace,
  externalSessionId,
  source,
  liveSession,
  readSessionHistory,
}: UseRuntimeTranscriptSessionHistoryArgs): RuntimeTranscriptSessionHistory {
  const sourceLiveSession =
    liveSession &&
    source &&
    liveSession.externalSessionId === externalSessionId &&
    liveSession.runtimeKind === source.runtimeKind &&
    liveSession.workingDirectory === source.workingDirectory
      ? liveSession
      : null;
  const historyQueryEnabled = Boolean(
    isOpen && activeWorkspace && externalSessionId && source && sourceLiveSession === null,
  );
  const historyQueryInput =
    source && activeWorkspace && externalSessionId
      ? {
          repoPath: activeWorkspace.repoPath,
          runtimeKind: source.runtimeKind,
          workingDirectory: source.workingDirectory,
          externalSessionId,
        }
      : null;

  const historyQuery = useQuery({
    queryKey: historyQueryInput
      ? agentSessionRuntimeQueryKeys.history(
          historyQueryInput.repoPath,
          historyQueryInput.runtimeKind,
          historyQueryInput.workingDirectory,
          historyQueryInput.externalSessionId,
        )
      : agentSessionRuntimeQueryKeys.historyUnavailable(),
    queryFn: historyQueryInput
      ? (): Promise<AgentSessionHistoryMessage[]> =>
          readSessionHistory(
            historyQueryInput.repoPath,
            historyQueryInput.runtimeKind,
            historyQueryInput.workingDirectory,
            historyQueryInput.externalSessionId,
          )
      : skipToken,
    enabled: historyQueryEnabled,
    staleTime: SESSION_HISTORY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });

  const session = useMemo(() => {
    if (sourceLiveSession) {
      return toReadonlyLiveTranscriptSession(sourceLiveSession);
    }
    if (!activeWorkspace || !source || !externalSessionId || !historyQuery.data) {
      return null;
    }

    return createReadonlyTranscriptSession({
      externalSessionId,
      runtimeKind: source.runtimeKind,
      workingDirectory: source.workingDirectory,
      history: historyQuery.data,
    });
  }, [activeWorkspace, externalSessionId, historyQuery.data, sourceLiveSession, source]);

  return {
    session,
    isHistoryLoading: historyQueryEnabled && historyQuery.isPending,
    historyError: historyQuery.error
      ? errorMessageFromUnknown(historyQuery.error, "Failed to load transcript history.")
      : null,
  };
}
