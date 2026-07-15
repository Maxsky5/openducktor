import type { AgentSessionHistoryMessage, PolicyBoundSessionRef } from "@openducktor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { pendingInputIdentity } from "@/lib/pending-input-identity";
import { observeTransientAgentSessionEvents } from "@/state/operations/agent-orchestrator/events/transient-session-events";
import { mergeHistoryMessages } from "@/state/operations/agent-orchestrator/support/history-message-merge";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import { applyQuestionAnswerToSession } from "@/state/operations/agent-orchestrator/support/question-messages";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import type { AgentSessionTranscriptTarget } from "../agent-session-transcript-target";
import {
  createEmptyReadonlyRuntimeSessionState,
  mergeReadonlyRuntimeHistory,
} from "./readonly-transcript-session";
import { errorMessageFromUnknown } from "./runtime-transcript-error";

type PendingInputOwnership = {
  projectedRequestIds: ReadonlySet<string>;
  runtimeRequestIds: ReadonlySet<string>;
  resolvedRequestIds: ReadonlySet<string>;
};

type PendingInputEntry = Parameters<typeof pendingInputIdentity>[0];

type RuntimeTranscriptLiveState = {
  session: AgentSessionState;
  hasRuntimeEvents: boolean;
  error: string | null;
  approvalOwnership: PendingInputOwnership;
  questionOwnership: PendingInputOwnership;
};

type RuntimeTranscriptLiveStateUpdater = (
  current: RuntimeTranscriptLiveState | null,
) => RuntimeTranscriptLiveState | null;

type RuntimeTranscriptLiveOverlay = {
  session: AgentSessionState | null;
  interactionSession: AgentSessionState | null;
  error: string | null;
  hasHistoryBase: boolean;
  hasVisibleRuntimeData: boolean;
  replyAgentApproval: AgentOperationsContextValue["replyAgentApproval"] | null;
  answerAgentQuestion: AgentOperationsContextValue["answerAgentQuestion"] | null;
};

type UseRuntimeTranscriptLiveOverlayArgs = {
  shouldObserve: boolean;
  repoPath: string | null;
  target: AgentSessionTranscriptTarget | null;
  sessionRef: PolicyBoundSessionRef | null;
  baseSession: AgentSessionState | null;
  projectedPendingApprovals: readonly AgentSessionState["pendingApprovals"][number][];
  projectedPendingQuestions: readonly AgentSessionState["pendingQuestions"][number][];
  history: AgentSessionHistoryMessage[] | undefined;
  shouldMergeHistory: boolean;
  replyAgentApproval: AgentOperationsContextValue["replyAgentApproval"];
  answerAgentQuestion: AgentOperationsContextValue["answerAgentQuestion"];
  subscribeSessionEvents: AgentOperationsContextValue["subscribeSessionEvents"];
};

const EMPTY_RUNTIME_TRANSCRIPT_LIVE_OVERLAY: RuntimeTranscriptLiveOverlay = {
  session: null,
  interactionSession: null,
  error: null,
  hasHistoryBase: false,
  hasVisibleRuntimeData: false,
  replyAgentApproval: null,
  answerAgentQuestion: null,
};

const hasVisibleRuntimeData = (session: AgentSessionState): boolean =>
  getSessionMessageCount(session) > 0 ||
  session.pendingApprovals.length > 0 ||
  session.pendingQuestions.length > 0;

const mergePendingInput = <Entry extends PendingInputEntry>(
  baseEntries: readonly Entry[],
  liveEntries: readonly Entry[],
  ownership: PendingInputOwnership,
): Entry[] => {
  const runtimeEntries = liveEntries.filter((entry) => {
    const requestIdentity = pendingInputIdentity(entry);
    return (
      ownership.runtimeRequestIds.has(requestIdentity) &&
      !ownership.resolvedRequestIds.has(requestIdentity)
    );
  });
  const runtimeRequestIds = new Set(runtimeEntries.map((entry) => entry.requestId));
  const entriesByRequestId = new Map<string, Entry>();
  for (const entry of baseEntries) {
    const requestIdentity = pendingInputIdentity(entry);
    if (
      !runtimeRequestIds.has(entry.requestId) &&
      !ownership.resolvedRequestIds.has(requestIdentity)
    ) {
      entriesByRequestId.set(requestIdentity, entry);
    }
  }
  for (const entry of runtimeEntries) {
    const requestIdentity = pendingInputIdentity(entry);
    entriesByRequestId.set(requestIdentity, entry);
  }
  return [...entriesByRequestId.values()];
};

const createPendingInputOwnership = <Entry extends PendingInputEntry>(
  projectedEntries: readonly Entry[],
): PendingInputOwnership => ({
  projectedRequestIds: new Set(projectedEntries.map(pendingInputIdentity)),
  runtimeRequestIds: new Set(),
  resolvedRequestIds: new Set(),
});

const applyRuntimePendingInputUpdate = <Entry extends PendingInputEntry>(
  ownership: PendingInputOwnership,
  previousEntries: readonly Entry[],
  nextEntries: readonly Entry[],
): PendingInputOwnership => {
  const previousEntriesByRequestId = new Map(
    previousEntries.map((entry) => [pendingInputIdentity(entry), entry]),
  );
  const nextRequestIds = new Set(nextEntries.map(pendingInputIdentity));
  const nextRuntimeRequestIds = new Set(
    [...ownership.runtimeRequestIds].filter((requestId) => nextRequestIds.has(requestId)),
  );
  const nextResolvedRequestIds = new Set(ownership.resolvedRequestIds);
  for (const entry of previousEntries) {
    const requestIdentity = pendingInputIdentity(entry);
    if (!nextRequestIds.has(requestIdentity)) {
      nextResolvedRequestIds.add(requestIdentity);
    }
  }
  for (const entry of nextEntries) {
    const requestIdentity = pendingInputIdentity(entry);
    // Pending-input event handlers replace only the request they update, while unrelated events
    // preserve entry identity. This keeps projected-only requests owned by the base snapshot.
    if (previousEntriesByRequestId.get(requestIdentity) !== entry) {
      nextRuntimeRequestIds.add(requestIdentity);
      nextResolvedRequestIds.delete(requestIdentity);
    }
  }
  return {
    ...ownership,
    runtimeRequestIds: nextRuntimeRequestIds,
    resolvedRequestIds: nextResolvedRequestIds,
  };
};

const applyProjectedPendingInputUpdate = <Entry extends PendingInputEntry>(
  ownership: PendingInputOwnership,
  nextEntries: readonly Entry[],
): PendingInputOwnership => {
  const nextProjectedRequestIds = new Set(nextEntries.map(pendingInputIdentity));
  const nextResolvedRequestIds = new Set(ownership.resolvedRequestIds);
  for (const requestId of ownership.projectedRequestIds) {
    if (!nextProjectedRequestIds.has(requestId) && !ownership.runtimeRequestIds.has(requestId)) {
      nextResolvedRequestIds.add(requestId);
    }
  }
  return {
    ...ownership,
    projectedRequestIds: nextProjectedRequestIds,
    resolvedRequestIds: nextResolvedRequestIds,
  };
};

const resolvePendingInput = (
  ownership: PendingInputOwnership,
  requestId: string,
): PendingInputOwnership => {
  const nextRuntimeRequestIds = new Set(ownership.runtimeRequestIds);
  nextRuntimeRequestIds.delete(requestId);
  const nextResolvedRequestIds = new Set(ownership.resolvedRequestIds);
  nextResolvedRequestIds.add(requestId);
  return {
    ...ownership,
    runtimeRequestIds: nextRuntimeRequestIds,
    resolvedRequestIds: nextResolvedRequestIds,
  };
};

const mergeBaseSessionIntoLiveOverlay = (
  baseSession: AgentSessionState,
  liveSession: AgentSessionState,
  approvalOwnership: PendingInputOwnership,
  questionOwnership: PendingInputOwnership,
): AgentSessionState => ({
  ...baseSession,
  status: liveSession.status,
  runtimeStatusMessage: liveSession.runtimeStatusMessage,
  messages: mergeHistoryMessages(
    liveSession.externalSessionId,
    baseSession.messages,
    liveSession.messages,
  ),
  ...(liveSession.contextUsage !== undefined ? { contextUsage: liveSession.contextUsage } : {}),
  pendingApprovals: mergePendingInput(
    baseSession.pendingApprovals,
    liveSession.pendingApprovals,
    approvalOwnership,
  ),
  pendingQuestions: mergePendingInput(
    baseSession.pendingQuestions,
    liveSession.pendingQuestions,
    questionOwnership,
  ),
  ...(liveSession.pendingUserMessageStartedAt !== undefined
    ? { pendingUserMessageStartedAt: liveSession.pendingUserMessageStartedAt }
    : {}),
  ...(liveSession.stopRequestedAt !== undefined
    ? { stopRequestedAt: liveSession.stopRequestedAt }
    : {}),
});

export function useRuntimeTranscriptLiveOverlay({
  shouldObserve,
  repoPath,
  target,
  sessionRef,
  baseSession,
  projectedPendingApprovals,
  projectedPendingQuestions,
  history,
  shouldMergeHistory,
  replyAgentApproval,
  answerAgentQuestion,
  subscribeSessionEvents,
}: UseRuntimeTranscriptLiveOverlayArgs): RuntimeTranscriptLiveOverlay {
  const [liveState, setLiveState] = useState<RuntimeTranscriptLiveState | null>(null);
  const liveStateRef = useRef<RuntimeTranscriptLiveState | null>(null);
  const baseSessionRef = useRef(baseSession);
  const projectedPendingApprovalsRef = useRef(projectedPendingApprovals);
  const projectedPendingQuestionsRef = useRef(projectedPendingQuestions);
  const replyAgentApprovalRef = useRef(replyAgentApproval);
  const answerAgentQuestionRef = useRef(answerAgentQuestion);
  const subscribeSessionEventsRef = useRef(subscribeSessionEvents);

  const commitLiveState = useCallback((nextState: RuntimeTranscriptLiveState | null): void => {
    liveStateRef.current = nextState;
    setLiveState(nextState);
  }, []);

  const updateLiveState = useCallback(
    (updater: RuntimeTranscriptLiveStateUpdater): void => {
      commitLiveState(updater(liveStateRef.current));
    },
    [commitLiveState],
  );

  useEffect(() => {
    baseSessionRef.current = baseSession;
    projectedPendingApprovalsRef.current = projectedPendingApprovals;
    projectedPendingQuestionsRef.current = projectedPendingQuestions;
    replyAgentApprovalRef.current = replyAgentApproval;
    answerAgentQuestionRef.current = answerAgentQuestion;
    subscribeSessionEventsRef.current = subscribeSessionEvents;
  }, [
    answerAgentQuestion,
    baseSession,
    projectedPendingApprovals,
    projectedPendingQuestions,
    replyAgentApproval,
    subscribeSessionEvents,
  ]);

  useEffect(() => {
    if (target === null) {
      return;
    }
    updateLiveState((current) => {
      if (!current || !matchesAgentSessionIdentity(current.session, target)) {
        return current;
      }
      const approvalOwnership = applyProjectedPendingInputUpdate(
        current.approvalOwnership,
        projectedPendingApprovals,
      );
      const questionOwnership = applyProjectedPendingInputUpdate(
        current.questionOwnership,
        projectedPendingQuestions,
      );
      const projectedBaseSession = {
        ...(baseSession ?? current.session),
        pendingApprovals: [...projectedPendingApprovals],
        pendingQuestions: [...projectedPendingQuestions],
      };
      return {
        ...current,
        approvalOwnership,
        questionOwnership,
        session: mergeBaseSessionIntoLiveOverlay(
          projectedBaseSession,
          current.session,
          approvalOwnership,
          questionOwnership,
        ),
      };
    });
  }, [baseSession, projectedPendingApprovals, projectedPendingQuestions, target, updateLiveState]);

  useEffect(() => {
    if (!shouldObserve || repoPath === null || target === null || sessionRef === null) {
      commitLiveState(null);
      return;
    }

    let isCancelled = false;
    let unsubscribe: (() => void) | null = null;

    const ensureSession = (): AgentSessionState => {
      const current = liveStateRef.current?.session;
      if (current && matchesAgentSessionIdentity(current, target)) {
        return current;
      }
      const currentBaseSession = baseSessionRef.current;
      if (currentBaseSession && matchesAgentSessionIdentity(currentBaseSession, target)) {
        return currentBaseSession;
      }
      return createEmptyReadonlyRuntimeSessionState(target);
    };

    const initialSession = {
      ...ensureSession(),
      pendingApprovals: [...projectedPendingApprovalsRef.current],
      pendingQuestions: [...projectedPendingQuestionsRef.current],
    };
    commitLiveState({
      session: initialSession,
      hasRuntimeEvents: false,
      error: null,
      approvalOwnership: createPendingInputOwnership(initialSession.pendingApprovals),
      questionOwnership: createPendingInputOwnership(initialSession.pendingQuestions),
    });

    void observeTransientAgentSessionEvents({
      subscribeEvents: (input, listener) => subscribeSessionEventsRef.current(input, listener),
      replyApproval: (...args) => replyAgentApprovalRef.current(...args),
      sessionRef,
      readSession: () => liveStateRef.current?.session ?? null,
      applySessionEvent: (updater) => {
        const currentState = liveStateRef.current;
        const currentSession = ensureSession();
        const nextSession = updater(currentSession);
        commitLiveState({
          session: nextSession,
          hasRuntimeEvents: true,
          error: null,
          approvalOwnership: applyRuntimePendingInputUpdate(
            currentState?.approvalOwnership ?? createPendingInputOwnership([]),
            currentSession.pendingApprovals,
            nextSession.pendingApprovals,
          ),
          questionOwnership: applyRuntimePendingInputUpdate(
            currentState?.questionOwnership ?? createPendingInputOwnership([]),
            currentSession.pendingQuestions,
            nextSession.pendingQuestions,
          ),
        });
        return nextSession;
      },
    })
      .then((nextUnsubscribe) => {
        if (isCancelled) {
          nextUnsubscribe();
          return;
        }
        unsubscribe = nextUnsubscribe;
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        commitLiveState({
          session: ensureSession(),
          hasRuntimeEvents: false,
          error: errorMessageFromUnknown(error, "Failed to subscribe to transcript updates."),
          approvalOwnership:
            liveStateRef.current?.approvalOwnership ?? createPendingInputOwnership([]),
          questionOwnership:
            liveStateRef.current?.questionOwnership ?? createPendingInputOwnership([]),
        });
      });

    return () => {
      isCancelled = true;
      unsubscribe?.();
    };
  }, [commitLiveState, repoPath, sessionRef, shouldObserve, target]);

  useEffect(() => {
    if (!shouldMergeHistory || target === null || !history) {
      return;
    }

    updateLiveState((current) => {
      const currentSession =
        current?.session && matchesAgentSessionIdentity(current.session, target)
          ? current.session
          : createEmptyReadonlyRuntimeSessionState(target);
      return {
        session: mergeReadonlyRuntimeHistory(currentSession, history),
        hasRuntimeEvents: current?.hasRuntimeEvents ?? false,
        error: current?.error ?? null,
        approvalOwnership: current?.approvalOwnership ?? createPendingInputOwnership([]),
        questionOwnership: current?.questionOwnership ?? createPendingInputOwnership([]),
      };
    });
  }, [history, shouldMergeHistory, target, updateLiveState]);

  const replyOverlayApproval = useCallback<AgentOperationsContextValue["replyAgentApproval"]>(
    async (identity, request, outcome, message) => {
      if (!sessionRef) {
        throw new Error("Cannot reply to a transcript approval without a runtime session ref.");
      }
      const replySession =
        baseSessionRef.current && matchesAgentSessionIdentity(baseSessionRef.current, sessionRef)
          ? identity
          : sessionRef;
      await replyAgentApprovalRef.current(replySession, request, outcome, message);
      updateLiveState((current) => {
        if (!current || !matchesAgentSessionIdentity(current.session, sessionRef)) {
          return current;
        }
        return {
          ...current,
          approvalOwnership: resolvePendingInput(
            current.approvalOwnership,
            pendingInputIdentity(request),
          ),
          session: {
            ...current.session,
            pendingApprovals: current.session.pendingApprovals.filter(
              (entry) => entry.requestId !== request.requestId,
            ),
          },
        };
      });
    },
    [sessionRef, updateLiveState],
  );

  const answerOverlayQuestion = useCallback<AgentOperationsContextValue["answerAgentQuestion"]>(
    async (identity, request, answers) => {
      if (!sessionRef) {
        throw new Error("Cannot answer a transcript question without a runtime session ref.");
      }
      const replySession =
        baseSessionRef.current && matchesAgentSessionIdentity(baseSessionRef.current, sessionRef)
          ? identity
          : sessionRef;
      await answerAgentQuestionRef.current(replySession, request, answers);
      updateLiveState((current) => {
        if (!current || !matchesAgentSessionIdentity(current.session, sessionRef)) {
          return current;
        }
        const { pendingQuestions, messages } = applyQuestionAnswerToSession(
          current.session,
          request.requestId,
          answers,
        );
        return {
          ...current,
          questionOwnership: resolvePendingInput(
            current.questionOwnership,
            pendingInputIdentity(request),
          ),
          session: {
            ...current.session,
            pendingQuestions,
            messages,
          },
        };
      });
    },
    [sessionRef, updateLiveState],
  );

  if (
    target === null ||
    !liveState?.session ||
    !matchesAgentSessionIdentity(liveState.session, target)
  ) {
    return EMPTY_RUNTIME_TRANSCRIPT_LIVE_OVERLAY;
  }

  const session = liveState.session;
  const hasRuntimeEvents = liveState.hasRuntimeEvents;
  return {
    session,
    interactionSession: hasRuntimeEvents ? session : null,
    error: liveState.error,
    hasHistoryBase: session.historyLoadState === "loaded",
    hasVisibleRuntimeData: hasRuntimeEvents && hasVisibleRuntimeData(session),
    replyAgentApproval: hasRuntimeEvents ? replyOverlayApproval : null,
    answerAgentQuestion: hasRuntimeEvents ? answerOverlayQuestion : null,
  };
}
