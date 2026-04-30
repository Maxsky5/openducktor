import { useEffect, useState } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  type AgentStudioReadinessState,
  deriveAgentStudioTaskHydrationState,
} from "./agent-studio-task-hydration-state";
import {
  type RuntimeAttachmentCandidate,
  useAgentStudioRuntimeAttachmentRetry,
} from "./use-agent-studio-runtime-attachment-retry";

type UseAgentStudioTaskHydrationParams = {
  activeWorkspace: ActiveWorkspace | null;
  activeTaskId: string;
  activeSession: AgentSessionState | null;
  agentStudioReadinessState: AgentStudioReadinessState;
  ensureSessionReadyForView: (input: {
    taskId: string;
    externalSessionId: string;
    repoReadinessState: AgentStudioReadinessState;
    recoveryDedupKey?: string | null;
  }) => Promise<boolean>;
  refreshRuntimeAttachmentSources: () => Promise<void>;
  runtimeAttachmentCandidates: RuntimeAttachmentCandidate[];
};

type UseAgentStudioTaskHydrationResult = {
  isActiveTaskHydrated: boolean;
  isActiveTaskHydrationFailed: boolean;
  isActiveSessionHistoryHydrated: boolean;
  isActiveSessionHistoryHydrationFailed: boolean;
  isActiveSessionHistoryHydrating: boolean;
  isWaitingForRuntimeReadiness: boolean;
};

export function useAgentStudioTaskHydration({
  activeWorkspace,
  activeTaskId,
  activeSession,
  agentStudioReadinessState,
  ensureSessionReadyForView,
  refreshRuntimeAttachmentSources,
  runtimeAttachmentCandidates,
}: UseAgentStudioTaskHydrationParams): UseAgentStudioTaskHydrationResult {
  const activeExternalSessionId = activeSession?.externalSessionId ?? null;
  const [requestState, setRequestState] = useState<{
    externalSessionId: string | null;
    status: "idle" | "pending" | "failed";
  }>({ externalSessionId: null, status: "idle" });
  const activeRuntimeAttachmentKey =
    activeWorkspace && activeTaskId && activeExternalSessionId
      ? `${activeWorkspace.repoPath}::${activeTaskId}::${activeExternalSessionId}`
      : null;
  const lifecycle = deriveAgentStudioTaskHydrationState({
    activeSession,
    agentStudioReadinessState,
  });

  useAgentStudioRuntimeAttachmentRetry({
    activeTaskId,
    activeExternalSessionId,
    shouldWaitForSessionRuntime: lifecycle.shouldWaitForRuntimeAttachment,
    activeRuntimeAttachmentKey,
    runtimeAttachmentCandidates,
    ensureSessionReadyForView,
    refreshRuntimeAttachmentSources,
    repoReadinessState: agentStudioReadinessState,
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
      repoReadinessState: agentStudioReadinessState,
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
    agentStudioReadinessState,
    ensureSessionReadyForView,
    lifecycle.phase,
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
