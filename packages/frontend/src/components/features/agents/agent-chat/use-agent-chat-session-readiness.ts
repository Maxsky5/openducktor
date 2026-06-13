import type { AgentSessionRecord } from "@openducktor/contracts";
import { useEffect, useMemo } from "react";
import {
  deriveSelectedAgentSessionViewLifecycle,
  type SelectedAgentSessionViewLifecycle,
  type SessionRepoReadinessState,
} from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type {
  AgentSessionRouteIdentity,
  AgentSessionState,
  EnsureSessionReadyForViewResult,
} from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";

type UseAgentChatSessionReadinessParams = {
  activeWorkspace: ActiveWorkspace | null;
  activeTaskId: string;
  selectedSessionRoute?: AgentSessionRouteIdentity | null;
  activeSession: AgentSessionState | null;
  persistedRecords?: AgentSessionRecord[];
  repoReadinessState: SessionRepoReadinessState;
  sessionLoadError?: string | null;
  ensureSessionReadyForView: (input: {
    taskId: string;
    externalSessionId: string;
    repoReadinessState: SessionRepoReadinessState;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<EnsureSessionReadyForViewResult>;
};

export type AgentChatSessionReadinessResult = {
  isActiveTaskReady: boolean;
  isActiveTaskReadinessFailed: boolean;
  selectedSessionLifecycle: SelectedAgentSessionViewLifecycle;
};

export function useAgentChatSessionReadiness({
  activeWorkspace,
  activeTaskId,
  selectedSessionRoute,
  activeSession,
  persistedRecords,
  repoReadinessState,
  sessionLoadError = null,
  ensureSessionReadyForView,
}: UseAgentChatSessionReadinessParams): AgentChatSessionReadinessResult {
  const activeSessionExternalSessionId = activeSession?.externalSessionId ?? null;
  const activeSessionRuntimeKind = activeSession?.runtimeKind ?? null;
  const activeSessionWorkingDirectory = activeSession?.workingDirectory ?? null;
  const activeSessionRoute = useMemo<AgentSessionRouteIdentity | null>(() => {
    if (
      activeSessionExternalSessionId !== null &&
      activeSessionRuntimeKind !== null &&
      activeSessionWorkingDirectory !== null
    ) {
      return {
        externalSessionId: activeSessionExternalSessionId,
        runtimeKind: activeSessionRuntimeKind,
        workingDirectory: activeSessionWorkingDirectory,
      };
    }

    return selectedSessionRoute ?? null;
  }, [
    activeSessionExternalSessionId,
    activeSessionRuntimeKind,
    activeSessionWorkingDirectory,
    selectedSessionRoute,
  ]);
  const selectedSessionViewLifecycle = useMemo(
    () =>
      deriveSelectedAgentSessionViewLifecycle({
        selectedSessionRoute: activeSessionRoute,
        session: activeSession,
        repoReadinessState,
        sessionLoadError,
      }),
    [activeSession, activeSessionRoute, repoReadinessState, sessionLoadError],
  );

  useEffect(() => {
    if (
      selectedSessionViewLifecycle.externalSessionId === null ||
      !selectedSessionViewLifecycle.shouldEnsureReadyForView
    ) {
      return;
    }

    void ensureSessionReadyForView({
      taskId: activeTaskId,
      externalSessionId: selectedSessionViewLifecycle.externalSessionId,
      repoReadinessState,
      ...(persistedRecords ? { persistedRecords } : {}),
    });
  }, [
    activeTaskId,
    ensureSessionReadyForView,
    persistedRecords,
    repoReadinessState,
    selectedSessionViewLifecycle,
  ]);

  return {
    isActiveTaskReady: Boolean(activeWorkspace && activeTaskId),
    isActiveTaskReadinessFailed: false,
    selectedSessionLifecycle: selectedSessionViewLifecycle,
  };
}
