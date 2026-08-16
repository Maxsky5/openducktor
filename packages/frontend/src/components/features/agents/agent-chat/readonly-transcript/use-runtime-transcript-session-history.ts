import type {
  AgentSessionHistoryMessage,
  AgentSkillCatalog,
  PolicyBoundSessionRef,
} from "@openducktor/core";
import { workflowAgentSessionScope } from "@openducktor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { useStableAgentSessionScope } from "@/lib/use-stable-agent-session-scope";
import { useRuntimeDefinitionsContext } from "@/state/app-state-contexts";
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
import {
  RUNTIME_CATALOG_STALE_TIME_MS,
  repoRuntimeSkillsQueryOptions,
} from "@/state/queries/runtime-catalog";
import { skippedQueryOptions } from "@/state/queries/skipped-query";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import type { AgentChatTranscriptSession } from "../agent-chat.types";
import { toAgentChatTranscriptSession } from "../agent-chat-transcript-session";
import type { AgentSessionTranscriptTarget } from "../agent-session-transcript-target";
import { withClaudeSkillMentions } from "../claude-skill-mentions";
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
  session: AgentChatTranscriptSession | null;
  interactionSession: AgentSessionState | null;
  transcriptState: AgentSessionTranscriptState;
  retryHistory: (() => void) | null;
  isRetryingHistory: boolean;
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

const skippedTranscriptSkillsQueryOptions = skippedQueryOptions<AgentSkillCatalog>({
  queryKey: ["runtime-transcript-skills", "skipped"] as const,
  staleTime: RUNTIME_CATALOG_STALE_TIME_MS,
});

export function useRuntimeTranscriptSessionHistory({
  isOpen,
  repoPath,
  target,
  repoReadinessState,
  liveSession,
}: UseRuntimeTranscriptSessionHistoryArgs): RuntimeTranscriptSessionHistory {
  const { readSessionHistory, replyAgentApproval, answerAgentQuestion } = useAgentOperations();
  const { loadRepoRuntimeSkills } = useRuntimeDefinitionsContext();
  const queryClient = useQueryClient();
  const targetExternalSessionId = target?.externalSessionId ?? null;
  const targetRuntimeKind = target?.runtimeKind ?? null;
  const targetWorkingDirectory = target?.workingDirectory ?? null;
  const targetSessionScope = useStableAgentSessionScope(target?.sessionScope);
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
      ...(targetSessionScope ? { sessionScope: targetSessionScope } : {}),
    };
  }, [targetExternalSessionId, targetRuntimeKind, targetSessionScope, targetWorkingDirectory]);
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
  const inheritedSessionScope = stableTarget?.sessionScope ?? null;
  const sessionScope = useMemo(
    () =>
      matchingSession?.role
        ? workflowAgentSessionScope(matchingSession.taskId, matchingSession.role)
        : inheritedSessionScope,
    [inheritedSessionScope, matchingSession?.role, matchingSession?.taskId],
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
  const { refetch: refetchHistory } = historyQuery;
  const skillsQuery = useQuery(
    emptyReason === null &&
      repoReadinessState === "ready" &&
      targetRuntimeKind === "claude" &&
      runtimeSessionRef !== null
      ? repoRuntimeSkillsQueryOptions(runtimeSessionRef, loadRepoRuntimeSkills)
      : skippedTranscriptSkillsQueryOptions,
  );
  const session = useMemo(() => {
    let transcriptSession: AgentChatTranscriptSession | null = null;
    if (matchingSession !== null) {
      transcriptSession = toAgentChatTranscriptSession(
        historyQuery.data
          ? mergeReadonlyRuntimeHistory(matchingSession, historyQuery.data)
          : matchingSession,
      );
    } else if (shouldLoadHistory && historyQuery.data && stableTarget !== null) {
      transcriptSession = createReadonlyTranscriptSession({
        ...stableTarget,
        history: historyQuery.data,
      });
    }
    return transcriptSession
      ? withClaudeSkillMentions(transcriptSession, skillsQuery.data?.skills ?? [])
      : null;
  }, [historyQuery.data, matchingSession, shouldLoadHistory, skillsQuery.data, stableTarget]);
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
  const retryHistory = useCallback(() => {
    void refetchHistory();
  }, [refetchHistory]);

  return {
    session,
    interactionSession: matchingSession,
    transcriptState,
    retryHistory: historyQuery.error ? retryHistory : null,
    isRetryingHistory: historyQuery.isFetching,
    replyAgentApproval,
    answerAgentQuestion,
  };
}
