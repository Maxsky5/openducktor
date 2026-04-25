import type { AgentSessionRecord } from "@openducktor/contracts";
import { useEffect, useState } from "react";
import {
  deriveAgentSessionViewLifecycle,
  type SessionRepoReadinessState,
} from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type { AgentSessionHistoryPreludeMode, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  type RuntimeAttachmentCandidate,
  useAgentChatRuntimeAttachmentRetry,
} from "./use-agent-chat-runtime-attachment-retry";

type UseAgentChatSessionHydrationParams = {
  activeWorkspace: ActiveWorkspace | null;
  activeTaskId: string;
  activeSession: AgentSessionState | null;
  historyPreludeMode?: AgentSessionHistoryPreludeMode;
  allowLiveSessionResume?: boolean;
  persistedRecords?: AgentSessionRecord[];
  repoReadinessState: SessionRepoReadinessState;
  ensureSessionReadyForView: (input: {
    taskId: string;
    sessionId: string;
    repoReadinessState: SessionRepoReadinessState;
    recoveryDedupKey?: string | null;
    historyPreludeMode?: AgentSessionHistoryPreludeMode;
    allowLiveSessionResume?: boolean;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<boolean>;
  refreshRuntimeAttachmentSources: () => Promise<void>;
  runtimeAttachmentCandidates: RuntimeAttachmentCandidate[];
};

export type AgentChatSessionHydrationResult = {
  isActiveTaskHydrated: boolean;
  isActiveTaskHydrationFailed: boolean;
  isActiveSessionHistoryHydrated: boolean;
  isActiveSessionHistoryHydrationFailed: boolean;
  isActiveSessionHistoryHydrating: boolean;
  isWaitingForRuntimeReadiness: boolean;
};

export function useAgentChatSessionHydration({
  activeWorkspace,
  activeTaskId,
  activeSession,
  historyPreludeMode,
  allowLiveSessionResume,
  persistedRecords,
  repoReadinessState,
  ensureSessionReadyForView,
  refreshRuntimeAttachmentSources,
  runtimeAttachmentCandidates,
}: UseAgentChatSessionHydrationParams): AgentChatSessionHydrationResult {
  const activeSessionId = activeSession?.sessionId ?? null;
  const [requestState, setRequestState] = useState<{
    sessionId: string | null;
    status: "idle" | "pending" | "failed";
  }>({ sessionId: null, status: "idle" });
  const activeRuntimeAttachmentKey =
    activeWorkspace && activeTaskId && activeSessionId
      ? `${activeWorkspace.repoPath}::${activeTaskId}::${activeSessionId}`
      : null;
  const lifecycle = deriveAgentSessionViewLifecycle({
    session: activeSession,
    repoReadinessState,
  });

  useAgentChatRuntimeAttachmentRetry({
    activeTaskId,
    activeSessionId,
    shouldWaitForSessionRuntime: lifecycle.shouldWaitForRuntimeAttachment,
    activeRuntimeAttachmentKey,
    runtimeAttachmentCandidates,
    ensureSessionReadyForView,
    refreshRuntimeAttachmentSources,
    repoReadinessState,
    ...(historyPreludeMode ? { historyPreludeMode } : {}),
    ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
    ...(persistedRecords ? { persistedRecords } : {}),
  });

  const isRequestFailed =
    requestState.sessionId === activeSessionId && requestState.status === "failed";
  const shouldEnsureSessionReady = lifecycle.shouldEnsureReadyForView && !isRequestFailed;

  useEffect(() => {
    if (!activeSessionId) {
      setRequestState({ sessionId: null, status: "idle" });
      return;
    }

    if (!shouldEnsureSessionReady || lifecycle.phase === "waiting_for_runtime_attachment") {
      setRequestState((current) =>
        current.sessionId === activeSessionId && current.status === "pending"
          ? { sessionId: activeSessionId, status: "idle" }
          : current,
      );
      return;
    }

    setRequestState({ sessionId: activeSessionId, status: "pending" });
    void ensureSessionReadyForView({
      taskId: activeTaskId,
      sessionId: activeSessionId,
      repoReadinessState,
      ...(historyPreludeMode ? { historyPreludeMode } : {}),
      ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
      ...(persistedRecords ? { persistedRecords } : {}),
    })
      .then(() => {
        setRequestState((current) =>
          current.sessionId === activeSessionId
            ? { sessionId: activeSessionId, status: "idle" }
            : current,
        );
      })
      .catch(() => {
        setRequestState((current) =>
          current.sessionId === activeSessionId
            ? { sessionId: activeSessionId, status: "failed" }
            : current,
        );
      });
  }, [
    activeSessionId,
    activeTaskId,
    ensureSessionReadyForView,
    historyPreludeMode,
    allowLiveSessionResume,
    lifecycle.phase,
    persistedRecords,
    repoReadinessState,
    shouldEnsureSessionReady,
  ]);

  const shouldShowPendingHydrationState =
    requestState.sessionId === activeSessionId && requestState.status === "pending";

  return {
    isActiveTaskHydrated: Boolean(activeWorkspace && activeTaskId),
    isActiveTaskHydrationFailed: false,
    isActiveSessionHistoryHydrated: activeSessionId ? lifecycle.canRenderHistory : false,
    isActiveSessionHistoryHydrationFailed: activeSessionId
      ? lifecycle.isHistoryHydrationFailed || isRequestFailed
      : false,
    isActiveSessionHistoryHydrating: activeSessionId
      ? shouldShowPendingHydrationState || lifecycle.isHydratingHistory
      : false,
    isWaitingForRuntimeReadiness: activeSessionId
      ? lifecycle.isWaitingForRuntimeReadiness && !isRequestFailed
      : false,
  };
}
