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
    sessionId: string;
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
  const activeSessionId = activeSession?.sessionId ?? null;
  const [requestState, setRequestState] = useState<{
    sessionId: string | null;
    status: "idle" | "pending" | "failed";
  }>({ sessionId: null, status: "idle" });
  const activeRuntimeAttachmentKey =
    activeWorkspace && activeTaskId && activeSessionId
      ? `${activeWorkspace.repoPath}::${activeTaskId}::${activeSessionId}`
      : null;
  const lifecycle = deriveAgentStudioTaskHydrationState({
    activeSession,
    agentStudioReadinessState,
  });

  useAgentStudioRuntimeAttachmentRetry({
    activeTaskId,
    activeSessionId,
    shouldWaitForSessionRuntime: lifecycle.shouldWaitForRuntimeAttachment,
    activeRuntimeAttachmentKey,
    runtimeAttachmentCandidates,
    ensureSessionReadyForView,
    refreshRuntimeAttachmentSources,
    repoReadinessState: agentStudioReadinessState,
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
      repoReadinessState: agentStudioReadinessState,
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
    agentStudioReadinessState,
    ensureSessionReadyForView,
    lifecycle.phase,
    shouldEnsureSessionReady,
  ]);

  const shouldShowPendingHydrationState = shouldEnsureSessionReady;

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
