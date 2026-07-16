import type { AgentSessionHistoryMessage, PolicyBoundSessionRef } from "@openducktor/core";
import { workflowAgentSessionScope } from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { useAgentOperations } from "@/state/app-state-provider";
import {
  type AgentSessionTranscriptEmptyReason,
  type AgentSessionTranscriptState,
  deriveRuntimeBoundTranscriptLoadingState,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import {
  runtimeSessionHistoryRefQueryOptions,
  SESSION_HISTORY_STALE_TIME_MS,
  sessionHistoryQueryOptions,
} from "@/state/queries/agent-session-history";
import { skippedQueryOptions } from "@/state/queries/skipped-query";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import type { AgentChatThreadSession } from "../agent-chat.types";
import { toAgentChatThreadSession } from "../agent-chat-thread-session";
import type { AgentSessionTranscriptTarget } from "../agent-session-transcript-target";
import {
  createReadonlyTranscriptSession,
  mergeReadonlyRuntimeHistory,
} from "./readonly-transcript-session";
import { errorMessageFromUnknown } from "./runtime-transcript-error";

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

const skippedTranscriptHistoryQueryOptions = skippedQueryOptions<AgentSessionHistoryMessage[]>({
  queryKey: ["runtime-transcript-session-history", "skipped"] as const,
  staleTime: SESSION_HISTORY_STALE_TIME_MS,
  refetchOnWindowFocus: false,
});

const skippedRuntimeSessionRefQueryOptions = skippedQueryOptions<PolicyBoundSessionRef>({
  queryKey: ["runtime-session-history-ref", "skipped"] as const,
  staleTime: Number.POSITIVE_INFINITY,
  refetchOnWindowFocus: false,
});

export function useRuntimeTranscriptSessionHistory({
  isOpen,
  repoPath,
  target,
  repoReadinessState,
  liveSession,
}: UseRuntimeTranscriptSessionHistoryArgs): RuntimeTranscriptSessionHistory {
  const { readSessionHistory, replyAgentApproval, answerAgentQuestion } = useAgentOperations();
  const queryClient = useQueryClient();
  const targetExternalSessionId = target?.externalSessionId ?? null;
  const targetRuntimeKind = target?.runtimeKind ?? null;
  const targetWorkingDirectory = target?.workingDirectory ?? null;
  const targetSessionScopeTaskId = target?.sessionScope?.taskId ?? null;
  const targetSessionScopeRole = target?.sessionScope?.role ?? null;
  const stableTarget = useMemo<AgentSessionTranscriptTarget | null>(() => {
    if (
      targetExternalSessionId === null ||
      targetRuntimeKind === null ||
      targetWorkingDirectory === null
    ) {
      return null;
    }
    return {
      externalSessionId: targetExternalSessionId,
      runtimeKind: targetRuntimeKind,
      workingDirectory: targetWorkingDirectory,
      ...(targetSessionScopeTaskId !== null && targetSessionScopeRole !== null
        ? {
            sessionScope: workflowAgentSessionScope(
              targetSessionScopeTaskId,
              targetSessionScopeRole,
            ),
          }
        : {}),
    };
  }, [
    targetExternalSessionId,
    targetRuntimeKind,
    targetSessionScopeRole,
    targetSessionScopeTaskId,
    targetWorkingDirectory,
  ]);
  let emptyReason: AgentSessionTranscriptEmptyReason | null = null;
  if (!isOpen) {
    emptyReason = "inactive";
  } else if (repoPath === null || stableTarget === null) {
    emptyReason = "unavailable";
  }
  const matchingSession =
    emptyReason === null &&
    stableTarget !== null &&
    liveSession !== null &&
    matchesAgentSessionIdentity(liveSession, stableTarget)
      ? liveSession
      : null;
  const sessionScopeTaskId = matchingSession?.role
    ? matchingSession.taskId
    : (stableTarget?.sessionScope?.taskId ?? null);
  const sessionScopeRole = matchingSession?.role ?? stableTarget?.sessionScope?.role ?? null;
  const sessionScope = useMemo(
    () =>
      sessionScopeTaskId !== null && sessionScopeRole !== null
        ? workflowAgentSessionScope(sessionScopeTaskId, sessionScopeRole)
        : null,
    [sessionScopeRole, sessionScopeTaskId],
  );
  const runtimeSessionRefInput = useMemo(() => {
    if (repoPath === null || stableTarget === null) {
      return null;
    }
    return {
      ...stableTarget,
      repoPath,
      sessionScope,
    };
  }, [repoPath, sessionScope, stableTarget]);
  const loadSettingsSnapshot = useCallback(
    () => queryClient.ensureQueryData(settingsSnapshotQueryOptions()),
    [queryClient],
  );
  const runtimeSessionRefQuery = useQuery(
    runtimeSessionRefInput !== null && emptyReason === null
      ? runtimeSessionHistoryRefQueryOptions(runtimeSessionRefInput, loadSettingsSnapshot)
      : skippedRuntimeSessionRefQueryOptions,
  );
  const runtimeSessionRef = runtimeSessionRefQuery.data ?? null;
  const runtimePolicyError = runtimeSessionRefQuery.error
    ? errorMessageFromUnknown(runtimeSessionRefQuery.error, "Failed to resolve runtime policy.")
    : null;
  const shouldLoadHistory =
    emptyReason === null &&
    runtimeSessionRef !== null &&
    matchingSession?.historyLoadState !== "loaded";
  const historyQuery = useQuery(
    shouldLoadHistory && repoReadinessState === "ready" && runtimeSessionRef !== null
      ? sessionHistoryQueryOptions(runtimeSessionRef, readSessionHistory)
      : skippedTranscriptHistoryQueryOptions,
  );
  const session = useMemo(() => {
    if (matchingSession !== null) {
      return toAgentChatThreadSession(
        historyQuery.data
          ? mergeReadonlyRuntimeHistory(matchingSession, historyQuery.data)
          : matchingSession,
      );
    }
    if (!shouldLoadHistory || !historyQuery.data || stableTarget === null) {
      return null;
    }
    return createReadonlyTranscriptSession({ ...stableTarget, history: historyQuery.data });
  }, [historyQuery.data, matchingSession, shouldLoadHistory, stableTarget]);
  const transcriptState = useMemo<AgentSessionTranscriptState>(() => {
    if (session !== null) {
      return { kind: "visible" };
    }
    if (emptyReason !== null) {
      return { kind: "empty", reason: emptyReason };
    }
    if (runtimePolicyError !== null && repoReadinessState === "ready") {
      return { kind: "failed", message: runtimePolicyError };
    }
    if (historyQuery.error && repoReadinessState === "ready") {
      return {
        kind: "failed",
        message: errorMessageFromUnknown(historyQuery.error, "Failed to load transcript history."),
      };
    }
    return deriveRuntimeBoundTranscriptLoadingState({
      reason: "history",
      repoReadinessState,
    });
  }, [emptyReason, historyQuery.error, repoReadinessState, runtimePolicyError, session]);

  return {
    session,
    interactionSession: matchingSession,
    transcriptState,
    replyAgentApproval,
    answerAgentQuestion,
  };
}
