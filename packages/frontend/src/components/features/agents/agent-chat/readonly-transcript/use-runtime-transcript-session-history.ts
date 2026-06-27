import { agentRoleValues } from "@openducktor/contracts";
import type {
  AgentRole,
  AgentSessionHistoryMessage,
  AgentSessionRuntimeRef,
} from "@openducktor/core";
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
import type { AgentChatThreadSession } from "../agent-chat.types";
import { toAgentChatThreadSession } from "../agent-chat-thread-session";
import type { AgentSessionTranscriptTarget } from "../agent-session-transcript-target";
import { createReadonlyTranscriptSession } from "./readonly-transcript-session";
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
};

const skippedTranscriptHistoryQueryOptions = skippedQueryOptions<AgentSessionHistoryMessage[]>({
  queryKey: ["runtime-transcript-session-history", "skipped"] as const,
  staleTime: SESSION_HISTORY_STALE_TIME_MS,
  refetchOnWindowFocus: false,
});

const agentRoleSet = new Set<string>(agentRoleValues);

const isAgentRole = (value: unknown): value is AgentRole =>
  typeof value === "string" && agentRoleSet.has(value);

export function useRuntimeTranscriptSessionHistory({
  isOpen,
  repoPath,
  target,
  repoReadinessState,
  liveSession,
}: UseRuntimeTranscriptSessionHistoryArgs): RuntimeTranscriptSessionHistory {
  const { readSessionHistory, replyAgentApproval, subscribeSessionEvents } = useAgentOperations();
  const targetExternalSessionId = target?.externalSessionId ?? null;
  const targetRuntimeKind = target?.runtimeKind ?? null;
  const targetWorkingDirectory = target?.workingDirectory ?? null;
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
    };
  }, [targetExternalSessionId, targetRuntimeKind, targetWorkingDirectory]);

  const emptyReason: AgentSessionTranscriptEmptyReason | null =
    !isOpen || stableTarget === null ? "inactive" : repoPath ? null : "unavailable";

  const matchingLiveSession =
    emptyReason === null &&
    liveSession !== null &&
    stableTarget !== null &&
    matchesAgentSessionIdentity(liveSession, stableTarget)
      ? liveSession
      : null;
  const runtimePolicyTarget = useMemo(() => {
    const policySession = matchingLiveSession ?? stableTarget;
    if (policySession === null) {
      return null;
    }
    const sessionScope =
      "taskId" in policySession &&
      typeof policySession.taskId === "string" &&
      "role" in policySession &&
      isAgentRole(policySession.role)
        ? { kind: "workflow" as const, taskId: policySession.taskId, role: policySession.role }
        : null;
    return {
      runtimeKind: policySession.runtimeKind,
      sessionScope,
    };
  }, [matchingLiveSession, stableTarget]);
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
  const runtimeSessionRef = useMemo<AgentSessionRuntimeRef | null>(() => {
    const policySession = matchingLiveSession ?? stableTarget;
    if (repoPath === null || policySession === null || runtimePolicy === null) {
      return null;
    }
    return toRuntimeSessionRefWithPolicy(repoPath, policySession, runtimePolicy);
  }, [matchingLiveSession, repoPath, runtimePolicy, stableTarget]);
  const shouldLoadHistory =
    emptyReason === null && matchingLiveSession === null && runtimeSessionRef !== null;
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
  };
}
