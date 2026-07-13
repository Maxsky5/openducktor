import { agentRoleValues } from "@openducktor/contracts";
import type {
  AgentRole,
  AgentSessionHistoryMessage,
  AgentSessionScope,
  PolicyBoundSessionRef,
} from "@openducktor/core";
import { workflowAgentSessionScope } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { useAgentOperations } from "@/state/app-state-provider";
import { resolveAgentSessionRuntimePolicyFromSnapshot } from "@/state/operations/agent-orchestrator/support/session-runtime-policy";
import { toRuntimeSessionRefWithPolicy } from "@/state/operations/agent-orchestrator/support/session-runtime-ref";
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
import { useRuntimeTranscriptLiveOverlay } from "./use-runtime-transcript-live-overlay";

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

const agentRoleSet = new Set<string>(agentRoleValues);

const isAgentRole = (value: unknown): value is AgentRole =>
  typeof value === "string" && agentRoleSet.has(value);

const sessionScopeForPolicySession = (
  policySession: AgentSessionState | AgentSessionTranscriptTarget,
): AgentSessionScope | null => {
  if (
    "taskId" in policySession &&
    typeof policySession.taskId === "string" &&
    "role" in policySession &&
    isAgentRole(policySession.role)
  ) {
    return workflowAgentSessionScope(policySession.taskId, policySession.role);
  }
  return "sessionScope" in policySession ? (policySession.sessionScope ?? null) : null;
};

export function useRuntimeTranscriptSessionHistory({
  isOpen,
  repoPath,
  target,
  repoReadinessState,
  liveSession,
}: UseRuntimeTranscriptSessionHistoryArgs): RuntimeTranscriptSessionHistory {
  const { readSessionHistory, replyAgentApproval, answerAgentQuestion, subscribeSessionEvents } =
    useAgentOperations();
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

  const emptyReason: AgentSessionTranscriptEmptyReason | null =
    !isOpen || stableTarget === null ? "inactive" : repoPath ? null : "unavailable";

  const matchingLiveSession =
    emptyReason === null &&
    liveSession !== null &&
    stableTarget !== null &&
    matchesAgentSessionIdentity(liveSession, stableTarget)
      ? liveSession
      : null;
  const policySession = matchingLiveSession ?? stableTarget;
  const policySessionRuntimeKind = policySession?.runtimeKind ?? null;
  const policySessionScope = policySession ? sessionScopeForPolicySession(policySession) : null;
  const policySessionScopeTaskId = policySessionScope?.taskId ?? null;
  const policySessionScopeRole = policySessionScope?.role ?? null;
  const runtimePolicyTarget = useMemo(() => {
    if (policySessionRuntimeKind === null) {
      return null;
    }
    return {
      runtimeKind: policySessionRuntimeKind,
      sessionScope:
        policySessionScopeTaskId !== null && policySessionScopeRole !== null
          ? workflowAgentSessionScope(policySessionScopeTaskId, policySessionScopeRole)
          : null,
    };
  }, [policySessionRuntimeKind, policySessionScopeRole, policySessionScopeTaskId]);
  const settingsSnapshotQuery = useQuery({
    ...settingsSnapshotQueryOptions(),
    enabled: runtimePolicyTarget?.runtimeKind === "codex",
    refetchOnWindowFocus: false,
  });
  const runtimePolicyResult = useMemo(() => {
    if (!runtimePolicyTarget) {
      return { runtimePolicy: null, error: null };
    }
    if (runtimePolicyTarget.runtimeKind === "opencode") {
      return { runtimePolicy: { kind: "opencode" } as const, error: null };
    }
    const settingsSnapshot = settingsSnapshotQuery.data;
    if (!settingsSnapshot) {
      return { runtimePolicy: null, error: null };
    }
    try {
      return {
        runtimePolicy: resolveAgentSessionRuntimePolicyFromSnapshot({
          ...runtimePolicyTarget,
          snapshot: settingsSnapshot,
        }),
        error: null,
      };
    } catch (error) {
      return {
        runtimePolicy: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [runtimePolicyTarget, settingsSnapshotQuery.data]);
  const runtimePolicyError =
    runtimePolicyResult.error ??
    (settingsSnapshotQuery.error instanceof Error ? settingsSnapshotQuery.error.message : null);
  const runtimePolicy = runtimePolicyResult.runtimePolicy;
  const runtimeSessionScope = runtimePolicyTarget?.sessionScope ?? null;
  const runtimeSessionRef = useMemo<PolicyBoundSessionRef | null>(() => {
    if (repoPath === null || stableTarget === null || runtimePolicy === null) {
      return null;
    }
    return {
      ...toRuntimeSessionRefWithPolicy(repoPath, stableTarget, runtimePolicy),
      ...(runtimeSessionScope ? { sessionScope: runtimeSessionScope } : {}),
    };
  }, [repoPath, runtimePolicy, runtimeSessionScope, stableTarget]);
  const shouldLoadHistory = emptyReason === null && runtimeSessionRef !== null;
  const shouldObserveRuntimeSession =
    shouldLoadHistory &&
    repoPath !== null &&
    stableTarget !== null &&
    repoReadinessState === "ready";

  const historyQuery = useQuery(
    shouldLoadHistory &&
      repoPath !== null &&
      runtimeSessionRef !== null &&
      repoReadinessState === "ready"
      ? sessionHistoryQueryOptions(runtimeSessionRef, readSessionHistory)
      : skippedTranscriptHistoryQueryOptions,
  );
  const liveOverlay = useRuntimeTranscriptLiveOverlay({
    shouldObserve: shouldObserveRuntimeSession,
    repoPath,
    target: stableTarget,
    sessionRef: runtimeSessionRef,
    baseSession: matchingLiveSession,
    history: historyQuery.data,
    shouldMergeHistory: shouldLoadHistory,
    replyAgentApproval,
    answerAgentQuestion,
    subscribeSessionEvents,
  });

  const session = useMemo(() => {
    if (liveOverlay.interactionSession !== null && liveOverlay.session !== null) {
      return toAgentChatThreadSession(liveOverlay.session);
    }
    if (matchingLiveSession !== null) {
      const sessionWithHistory = historyQuery.data
        ? mergeReadonlyRuntimeHistory(matchingLiveSession, historyQuery.data)
        : matchingLiveSession;
      return toAgentChatThreadSession(sessionWithHistory);
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
    liveOverlay.interactionSession,
    liveOverlay.session,
    matchingLiveSession,
    repoPath,
    shouldLoadHistory,
    stableTarget,
  ]);
  const interactionSession = liveOverlay.interactionSession ?? matchingLiveSession;
  const useTransientInteractionActions = liveOverlay.interactionSession !== null;
  const transcriptState = useMemo<AgentSessionTranscriptState>(() => {
    if (session !== null) {
      return { kind: "visible" };
    }
    if (emptyReason !== null) {
      return { kind: "empty", reason: emptyReason };
    }
    if (runtimePolicyError && repoReadinessState === "ready") {
      return {
        kind: "failed",
        message: runtimePolicyError,
      };
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
  }, [
    emptyReason,
    historyQuery.error,
    liveOverlay.error,
    repoReadinessState,
    runtimePolicyError,
    session,
  ]);

  return {
    session,
    interactionSession,
    transcriptState,
    replyAgentApproval:
      useTransientInteractionActions && liveOverlay.replyAgentApproval
        ? liveOverlay.replyAgentApproval
        : replyAgentApproval,
    answerAgentQuestion:
      useTransientInteractionActions && liveOverlay.answerAgentQuestion
        ? liveOverlay.answerAgentQuestion
        : answerAgentQuestion,
  };
}
