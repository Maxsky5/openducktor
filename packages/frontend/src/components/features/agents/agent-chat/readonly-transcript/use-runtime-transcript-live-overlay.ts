import type { AgentSessionHistoryMessage, PolicyBoundSessionRef } from "@openducktor/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { observeTransientAgentSessionEvents } from "@/state/operations/agent-orchestrator/events/transient-session-events";
import { mergeHistoryMessages } from "@/state/operations/agent-orchestrator/support/history-message-merge";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import type { AgentSessionTranscriptTarget } from "../agent-session-transcript-target";
import {
  createEmptyReadonlyRuntimeSessionState,
  mergeReadonlyRuntimeHistory,
} from "./readonly-transcript-session";
import { errorMessageFromUnknown } from "./runtime-transcript-error";

type RuntimeTranscriptLiveState = {
  session: AgentSessionState;
  hasRuntimeEvents: boolean;
  error: string | null;
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

const mergePendingInput = <Entry extends { requestId: string }>(
  baseEntries: Entry[],
  runtimeEntries: Entry[],
): Entry[] => {
  const runtimeRequestIds = new Set(runtimeEntries.map((entry) => entry.requestId));
  return [
    ...baseEntries.filter((entry) => !runtimeRequestIds.has(entry.requestId)),
    ...runtimeEntries,
  ];
};

const mergeBaseSessionIntoLiveOverlay = (
  baseSession: AgentSessionState,
  liveSession: AgentSessionState,
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
  pendingApprovals: mergePendingInput(baseSession.pendingApprovals, liveSession.pendingApprovals),
  pendingQuestions: mergePendingInput(baseSession.pendingQuestions, liveSession.pendingQuestions),
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
  history,
  shouldMergeHistory,
  replyAgentApproval,
  answerAgentQuestion,
  subscribeSessionEvents,
}: UseRuntimeTranscriptLiveOverlayArgs): RuntimeTranscriptLiveOverlay {
  const [liveState, setLiveState] = useState<RuntimeTranscriptLiveState | null>(null);
  const liveStateRef = useRef<RuntimeTranscriptLiveState | null>(null);
  const baseSessionRef = useRef(baseSession);
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
    replyAgentApprovalRef.current = replyAgentApproval;
    answerAgentQuestionRef.current = answerAgentQuestion;
    subscribeSessionEventsRef.current = subscribeSessionEvents;
  }, [answerAgentQuestion, baseSession, replyAgentApproval, subscribeSessionEvents]);

  useEffect(() => {
    if (!baseSession || target === null) {
      return;
    }
    updateLiveState((current) => {
      if (!current?.hasRuntimeEvents || !matchesAgentSessionIdentity(current.session, target)) {
        return current;
      }
      return {
        ...current,
        session: mergeBaseSessionIntoLiveOverlay(baseSession, current.session),
      };
    });
  }, [baseSession, target, updateLiveState]);

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

    commitLiveState({
      session: ensureSession(),
      hasRuntimeEvents: false,
      error: null,
    });

    void observeTransientAgentSessionEvents({
      subscribeEvents: (input, listener) => subscribeSessionEventsRef.current(input, listener),
      replyApproval: (...args) => replyAgentApprovalRef.current(...args),
      sessionRef,
      readSession: () => liveStateRef.current?.session ?? null,
      applySessionEvent: (updater) => {
        const nextSession = updater(ensureSession());
        commitLiveState({
          session: nextSession,
          hasRuntimeEvents: true,
          error: null,
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
      };
    });
  }, [history, shouldMergeHistory, target, updateLiveState]);

  const replyOverlayApproval = useCallback<AgentOperationsContextValue["replyAgentApproval"]>(
    async (_identity, request, outcome, message) => {
      if (!sessionRef) {
        throw new Error("Cannot reply to a transcript approval without a runtime session ref.");
      }
      await replyAgentApprovalRef.current(sessionRef, request, outcome, message);
      updateLiveState((current) => {
        if (!current || !matchesAgentSessionIdentity(current.session, sessionRef)) {
          return current;
        }
        return {
          ...current,
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
    async (_identity, request, answers) => {
      if (!sessionRef) {
        throw new Error("Cannot answer a transcript question without a runtime session ref.");
      }
      await answerAgentQuestionRef.current(sessionRef, request, answers);
      updateLiveState((current) => {
        if (!current || !matchesAgentSessionIdentity(current.session, sessionRef)) {
          return current;
        }
        return {
          ...current,
          session: {
            ...current.session,
            pendingQuestions: current.session.pendingQuestions.filter(
              (entry) => entry.requestId !== request.requestId,
            ),
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
