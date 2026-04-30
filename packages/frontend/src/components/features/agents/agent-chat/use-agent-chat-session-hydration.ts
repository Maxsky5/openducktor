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
    externalSessionId: string;
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
  const activeExternalSessionId = activeSession?.externalSessionId ?? null;
  const [requestState, setRequestState] = useState<{
    externalSessionId: string | null;
    status: "idle" | "pending" | "failed";
  }>({ externalSessionId: null, status: "idle" });
  const activeRuntimeAttachmentKey =
    activeWorkspace && activeTaskId && activeExternalSessionId
      ? `${activeWorkspace.repoPath}::${activeTaskId}::${activeExternalSessionId}`
      : null;
  const lifecycle = deriveAgentSessionViewLifecycle({
    session: activeSession,
    repoReadinessState,
  });

  useAgentChatRuntimeAttachmentRetry({
    activeTaskId,
    activeExternalSessionId,
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
    requestState.externalSessionId === activeExternalSessionId && requestState.status === "failed";
  const shouldEnsureSessionReady = lifecycle.shouldEnsureReadyForView && !isRequestFailed;

  useEffect(() => {
    if (!activeExternalSessionId) {
      setRequestState({ externalSessionId: null, status: "idle" });
      return;
    }

    if (!shouldEnsureSessionReady || lifecycle.phase === "waiting_for_runtime_attachment") {
      setRequestState((current) =>
        current.externalSessionId === activeExternalSessionId && current.status === "pending"
          ? { externalSessionId: activeExternalSessionId, status: "idle" }
          : current,
      );
      return;
    }

    setRequestState({ externalSessionId: activeExternalSessionId, status: "pending" });
    void ensureSessionReadyForView({
      taskId: activeTaskId,
      externalSessionId: activeExternalSessionId,
      repoReadinessState,
      ...(historyPreludeMode ? { historyPreludeMode } : {}),
      ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
      ...(persistedRecords ? { persistedRecords } : {}),
    })
      .then(() => {
        setRequestState((current) =>
          current.externalSessionId === activeExternalSessionId
            ? { externalSessionId: activeExternalSessionId, status: "idle" }
            : current,
        );
      })
      .catch(() => {
        setRequestState((current) =>
          current.externalSessionId === activeExternalSessionId
            ? { externalSessionId: activeExternalSessionId, status: "failed" }
            : current,
        );
      });
  }, [
    activeExternalSessionId,
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
    requestState.externalSessionId === activeExternalSessionId && requestState.status === "pending";

  return {
    isActiveTaskHydrated: Boolean(activeWorkspace && activeTaskId),
    isActiveTaskHydrationFailed: false,
    isActiveSessionHistoryHydrated: activeExternalSessionId ? lifecycle.canRenderHistory : false,
    isActiveSessionHistoryHydrationFailed: activeExternalSessionId
      ? lifecycle.isHistoryHydrationFailed || isRequestFailed
      : false,
    isActiveSessionHistoryHydrating: activeExternalSessionId
      ? shouldShowPendingHydrationState || lifecycle.isHydratingHistory
      : false,
    isWaitingForRuntimeReadiness: activeExternalSessionId
      ? lifecycle.isWaitingForRuntimeReadiness && !isRequestFailed
      : false,
  };
}
