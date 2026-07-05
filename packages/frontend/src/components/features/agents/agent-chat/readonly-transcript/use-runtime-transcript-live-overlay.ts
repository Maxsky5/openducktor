import type { AgentSessionHistoryMessage, PolicyBoundSessionRef } from "@openducktor/core";
import { useEffect, useRef, useState } from "react";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { observeTransientAgentSessionEvents } from "@/state/operations/agent-orchestrator/events/transient-session-events";
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

type RuntimeTranscriptLiveOverlay = {
  session: AgentSessionState | null;
  interactionSession: AgentSessionState | null;
  error: string | null;
  hasHistoryBase: boolean;
  hasVisibleRuntimeData: boolean;
};

type UseRuntimeTranscriptLiveOverlayArgs = {
  shouldObserve: boolean;
  repoPath: string | null;
  target: AgentSessionTranscriptTarget | null;
  sessionRef: PolicyBoundSessionRef | null;
  history: AgentSessionHistoryMessage[] | undefined;
  shouldMergeHistory: boolean;
  replyAgentApproval: AgentOperationsContextValue["replyAgentApproval"];
  subscribeSessionEvents: AgentOperationsContextValue["subscribeSessionEvents"];
};

const EMPTY_RUNTIME_TRANSCRIPT_LIVE_OVERLAY: RuntimeTranscriptLiveOverlay = {
  session: null,
  interactionSession: null,
  error: null,
  hasHistoryBase: false,
  hasVisibleRuntimeData: false,
};

const hasVisibleRuntimeData = (session: AgentSessionState): boolean =>
  getSessionMessageCount(session) > 0 ||
  session.pendingApprovals.length > 0 ||
  session.pendingQuestions.length > 0;

export function useRuntimeTranscriptLiveOverlay({
  shouldObserve,
  repoPath,
  target,
  sessionRef,
  history,
  shouldMergeHistory,
  replyAgentApproval,
  subscribeSessionEvents,
}: UseRuntimeTranscriptLiveOverlayArgs): RuntimeTranscriptLiveOverlay {
  const [liveState, setLiveState] = useState<RuntimeTranscriptLiveState | null>(null);
  const liveStateRef = useRef<RuntimeTranscriptLiveState | null>(null);

  useEffect(() => {
    liveStateRef.current = liveState;
  }, [liveState]);

  useEffect(() => {
    if (!shouldObserve || repoPath === null || target === null || sessionRef === null) {
      liveStateRef.current = null;
      setLiveState(null);
      return;
    }

    let isCancelled = false;
    let unsubscribe: (() => void) | null = null;

    const ensureSession = (): AgentSessionState => {
      const current = liveStateRef.current?.session;
      if (current && matchesAgentSessionIdentity(current, target)) {
        return current;
      }
      return createEmptyReadonlyRuntimeSessionState(target);
    };

    const setNextState = (nextState: RuntimeTranscriptLiveState): void => {
      liveStateRef.current = nextState;
      setLiveState(nextState);
    };

    setNextState({
      session: ensureSession(),
      hasRuntimeEvents: false,
      error: null,
    });

    void observeTransientAgentSessionEvents({
      subscribeEvents: subscribeSessionEvents,
      replyApproval: replyAgentApproval,
      sessionRef,
      readSession: () => liveStateRef.current?.session ?? null,
      applySessionEvent: (updater) => {
        const nextSession = updater(ensureSession());
        setNextState({
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
        setNextState({
          session: ensureSession(),
          hasRuntimeEvents: false,
          error: errorMessageFromUnknown(error, "Failed to subscribe to transcript updates."),
        });
      });

    return () => {
      isCancelled = true;
      unsubscribe?.();
    };
  }, [repoPath, replyAgentApproval, sessionRef, shouldObserve, subscribeSessionEvents, target]);

  useEffect(() => {
    if (!shouldMergeHistory || target === null || !history) {
      return;
    }

    setLiveState((current) => {
      const currentSession =
        current?.session && matchesAgentSessionIdentity(current.session, target)
          ? current.session
          : createEmptyReadonlyRuntimeSessionState(target);
      const nextState: RuntimeTranscriptLiveState = {
        session: mergeReadonlyRuntimeHistory(currentSession, history),
        hasRuntimeEvents: current?.hasRuntimeEvents ?? false,
        error: current?.error ?? null,
      };
      liveStateRef.current = nextState;
      return nextState;
    });
  }, [history, shouldMergeHistory, target]);

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
  };
}
