import { useRuntimeAvailabilityContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { isAgentSessionTranscriptLoading } from "@openducktor/frontend-core/sessions/agent-orchestrator/transcript/session-transcript-state";
import { useRuntimeTranscriptSessionHistory } from "@openducktor/frontend-core/sessions/readonly-transcript/use-runtime-transcript-session-history";
import { deriveAgentChatReadiness } from "@openducktor/frontend-core/sessions/send/agent-chat-readiness";
import { resolveAgentChatRuntimePresentation } from "@openducktor/frontend-core/sessions/send/agent-chat-runtime-presentation";
import type { AgentChatTranscriptNoticeAction } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import {
  useAgentOperationsContext,
  useAgentSessionReadModelStateContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import { useAgentSession } from "@openducktor/frontend-core/sessions/session-store-hooks";
import { resolveAgentChatTranscriptPresentation } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-presentation";
import { toAgentChatTranscriptSession } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-session";
import { useAgentChatPresentation } from "@openducktor/frontend-core/sessions/transcript/use-agent-chat-presentation";
import { useFailedTranscriptAction } from "@openducktor/frontend-core/sessions/transcript/use-failed-transcript-action";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionIdentity,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import { workspaceSessionTitle } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import { type ReactElement, useDeferredValue, useMemo } from "react";
import { useCommandGate, useResuming } from "@/host-session/active-session-context";
import { useRetryOnReconnect } from "@/host-session/use-retry-on-reconnect";
import { mergePendingCounts, deriveLiveTranscriptState } from "./session-transcript-state";
import { useSessionScreen } from "./session-target";
import type { JumpToLatestSignal } from "./transcript/jump-to-latest-signal";
import { SessionTranscript } from "./transcript/session-transcript";
import { useSessionSkills } from "./use-session-skills";

const NO_APPROVALS: readonly AgentApprovalRequest[] = Object.freeze([]);
const NO_QUESTIONS: readonly AgentQuestionRequest[] = Object.freeze([]);
const NO_COUNTS: Readonly<Record<string, number>> = Object.freeze({});

type SourceProps = {
  latestSignal: JumpToLatestSignal;
  onOpenSubagent: (identity: AgentSessionIdentity) => void;
};

/** A notice action that waits for the host connection. */
const gatedAction = (
  action: AgentChatTranscriptNoticeAction | null,
  gateOpen: boolean,
): AgentChatTranscriptNoticeAction | null =>
  action && !gateOpen ? { ...action, disabled: true } : action;

const useRuntimePresentation = (runtimeKind: AgentSessionIdentity["runtimeKind"]) => {
  const { allRuntimeDefinitions } = useRuntimeAvailabilityContext();
  return useMemo(
    () =>
      resolveAgentChatRuntimePresentation({
        runtimeDefinitions: allRuntimeDefinitions,
        runtimeKind,
      }),
    [allRuntimeDefinitions, runtimeKind],
  );
};

/**
 * The transcript of a live session. Only the open session builds transcript rows; this
 * component is the one view that renders again on each streamed change.
 */
export function LiveSessionTranscript({ latestSignal, onOpenSubagent }: SourceProps): ReactElement {
  const { target, interaction } = useSessionScreen();
  const { open: gateOpen } = useCommandGate();
  const { identity, repoPath, sessionKey, owner, sessionScope } = target;
  const { runtimeReadiness } = interaction;
  // A live change renders at transition priority, so a tap or a keystroke never waits for it, and
  // a burst of streamed events renders once. The whole transcript pipeline reads this value, so an
  // urgent render of this view reuses its memoized work.
  const session = useDeferredValue(useAgentSession(identity));
  const readModel = useAgentSessionReadModelStateContext();
  const { loadAgentSessionHistory } = useAgentOperationsContext();
  const fault = readModel.getSessionFault(identity);
  const resuming = useResuming();
  const transcriptState = deriveLiveTranscriptState({
    session,
    faultMessage: fault?.message ?? null,
    readModelLoadState: readModel.sessionReadModelLoadState,
    runtimeReadinessState: runtimeReadiness.state,
    resuming,
  });
  const chatTitle = owner.kind === "chat" ? workspaceSessionTitle(owner.record) : null;
  const baseSession = useMemo(() => {
    if (!session) return null;
    const transcriptSession = toAgentChatTranscriptSession(session);
    return chatTitle ? { ...transcriptSession, title: chatTitle } : transcriptSession;
  }, [chatTitle, session]);
  const skills = useSessionSkills();
  const presentation = useAgentChatPresentation({
    session: baseSession,
    sessionIdentity: identity,
    pendingApprovals: session?.pendingApprovals ?? NO_APPROVALS,
    pendingQuestions: session?.pendingQuestions ?? NO_QUESTIONS,
    skills,
    runtimeReadiness,
  });
  const recovery = useFailedTranscriptAction({
    scopeKey: repoPath,
    transcriptState,
    identity,
    hasLoadedSession: session !== null,
    observationFailed: readModel.sessionReadModelLoadState.kind === "failed" || fault !== null,
    observationPending: readModel.sessionReadModelLoadState.kind === "loading",
    loadHistory: loadAgentSessionHistory,
    reloadReadModel: readModel.reloadSessionReadModel,
  });
  useRetryOnReconnect(gateOpen, recovery.action?.onAction ?? null);
  const readiness = deriveAgentChatReadiness({
    transcriptState,
    runtimeReadiness,
    runtimeBlockedAction: presentation.runtimeBlockedAction,
    failedTranscriptAction: gatedAction(recovery.action, gateOpen),
  });
  const transcriptTarget = useMemo(() => ({ ...identity, sessionScope }), [identity, sessionScope]);
  const transcript = resolveAgentChatTranscriptPresentation({
    repoPath,
    sessionKey,
    session: presentation.transcriptSession,
    target: transcriptTarget,
    state: transcriptState,
    notice: readiness.transcriptNotice,
  });
  const runtimePresentation = useRuntimePresentation(identity.runtimeKind);
  const pendingCounts = useMemo(
    () =>
      mergePendingCounts(
        presentation.subagentPendingApprovalCountBySessionKey,
        presentation.subagentPendingQuestionCountBySessionKey,
      ),
    [
      presentation.subagentPendingApprovalCountBySessionKey,
      presentation.subagentPendingQuestionCountBySessionKey,
    ],
  );
  const notice = useDeferredValue(transcript.notice);
  const pendingCountsShown = useDeferredValue(pendingCounts);
  return (
    <SessionTranscript
      transcriptSession={transcript.session}
      notice={notice}
      isLoading={isAgentSessionTranscriptLoading(transcriptState)}
      runtimePresentation={runtimePresentation}
      subagentPendingCountBySessionKey={pendingCountsShown}
      onOpenSubagent={onOpenSubagent}
      latestSignal={latestSignal}
    />
  );
}

/**
 * The transcript of a Read-only Session View, such as a Subagent session. It reads the runtime
 * history when the session store does not follow the session live.
 */
export function ReadOnlySessionTranscript({
  latestSignal,
  onOpenSubagent,
}: SourceProps): ReactElement {
  const { target, interaction } = useSessionScreen();
  const { open: gateOpen } = useCommandGate();
  const { identity, repoPath, sessionKey, sessionScope } = target;
  const { runtimeReadiness } = interaction;
  const liveSession = useAgentSession(identity);
  const transcriptTarget = useMemo(() => ({ ...identity, sessionScope }), [identity, sessionScope]);
  const history = useRuntimeTranscriptSessionHistory({
    isOpen: true,
    repoPath,
    target: transcriptTarget,
    runtimeReadinessState: runtimeReadiness.state,
    liveSession,
  });
  const failedTranscriptAction = useMemo<AgentChatTranscriptNoticeAction | null>(
    () =>
      history.retryHistory
        ? {
            label: "Retry",
            onAction: history.retryHistory,
            disabled: history.isRetryingHistory || !gateOpen,
            isPending: history.isRetryingHistory,
          }
        : null,
    [gateOpen, history.isRetryingHistory, history.retryHistory],
  );
  const catalogSurfaceFailure = useMemo(() => {
    if (history.skillSurfaceError === null) return null;
    const action: AgentChatTranscriptNoticeAction | null = history.retrySkills
      ? {
          label: "Retry",
          onAction: history.retrySkills,
          disabled: history.isRetryingSkills || !gateOpen,
          isPending: history.isRetryingSkills,
        }
      : null;
    return { message: history.skillSurfaceError, action };
  }, [gateOpen, history.isRetryingSkills, history.retrySkills, history.skillSurfaceError]);
  const { refreshChecks, isLoadingChecks } = runtimeReadiness;
  const runtimeBlockedAction = useMemo(
    () => ({
      label: "Recheck",
      onAction: () => void refreshChecks(),
      disabled: isLoadingChecks,
      isPending: isLoadingChecks,
    }),
    [isLoadingChecks, refreshChecks],
  );
  const readiness = deriveAgentChatReadiness({
    transcriptState: history.transcriptState,
    runtimeReadiness,
    runtimeBlockedAction,
    failedTranscriptAction,
    catalogSurfaceFailure,
  });
  const transcript = resolveAgentChatTranscriptPresentation({
    repoPath,
    sessionKey,
    session: history.session,
    target: transcriptTarget,
    state: history.transcriptState,
    notice: readiness.transcriptNotice,
  });
  const runtimePresentation = useRuntimePresentation(identity.runtimeKind);
  return (
    <SessionTranscript
      transcriptSession={transcript.session}
      notice={transcript.notice}
      isLoading={isAgentSessionTranscriptLoading(history.transcriptState)}
      runtimePresentation={runtimePresentation}
      subagentPendingCountBySessionKey={NO_COUNTS}
      onOpenSubagent={onOpenSubagent}
      latestSignal={latestSignal}
    />
  );
}
