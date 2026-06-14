import type { RepoPromptOverrides, RuntimeKind } from "@openducktor/contracts";
import {
  type AgentEnginePort,
  type AgentRole,
  buildReadOnlyPermissionRejectionMessage,
} from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { listenToAgentSessionEvents } from "../events/session-events";
import { createSessionRuntimeDataWriter } from "../support/session-runtime-data-writer";
import type { ListenToAgentSession } from "../support/session-runtime-ref";
import type { UpdateAgentSession } from "./use-agent-session-mutations";
import type { useOrchestratorSessionState } from "./use-orchestrator-session-state";

type RefBridges = ReturnType<typeof useOrchestratorSessionState>["refBridges"];

type UseAgentSessionListenersArgs = {
  agentEngine: AgentEnginePort;
  workspaceId: string | null;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
  refBridges: RefBridges;
  sessionsRef: { current: Record<string, AgentSessionState> };
  commitSessions: (
    updater:
      | Record<string, AgentSessionState>
      | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
  ) => void;
  updateSession: UpdateAgentSession;
  queryClient: QueryClient;
  recordTurnActivityTimestamp: (externalSessionId: string, timestamp: string | number) => void;
  recordTurnUserMessageTimestamp: (
    externalSessionId: string,
    timestamp: string | number,
  ) => number | undefined;
  resolveTurnDurationMs: (
    externalSessionId: string,
    timestamp: string,
    messages?: AgentSessionState["messages"],
  ) => number | undefined;
  clearTurnDuration: (externalSessionId: string, completedTimestamp?: string) => void;
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: { forceFreshTaskList?: boolean },
  ) => Promise<void>;
};

export const useAgentSessionListeners = ({
  agentEngine,
  workspaceId,
  loadRepoPromptOverrides,
  refBridges,
  sessionsRef,
  commitSessions,
  updateSession,
  queryClient,
  recordTurnActivityTimestamp,
  recordTurnUserMessageTimestamp,
  resolveTurnDurationMs,
  clearTurnDuration,
  refreshTaskData,
}: UseAgentSessionListenersArgs) => {
  const { unsubscribersRef } = refBridges;
  const runtimeDataWriter = useMemo(
    () => createSessionRuntimeDataWriter(queryClient),
    [queryClient],
  );
  const buildReadOnlyApprovalRejectionMessage = useCallback(
    async (role: AgentRole): Promise<string> => {
      if (!workspaceId) {
        throw new Error("Active workspace is required to build approval rejection text.");
      }
      const promptOverrides = await loadRepoPromptOverrides(workspaceId);
      return buildReadOnlyPermissionRejectionMessage({
        role,
        overrides: promptOverrides,
      });
    },
    [loadRepoPromptOverrides, workspaceId],
  );

  const removeSessionIds = useCallback(
    (externalSessionIds: string[]): void => {
      if (externalSessionIds.length === 0) {
        return;
      }

      for (const externalSessionId of externalSessionIds) {
        const unsubscribe = unsubscribersRef.current.get(externalSessionId);
        unsubscribe?.();
        unsubscribersRef.current.delete(externalSessionId);

        const flushTimeout = refBridges.draftFlushTimeoutBySessionRef.current[externalSessionId];
        if (flushTimeout !== undefined) {
          clearTimeout(flushTimeout);
        }
        delete refBridges.draftFlushTimeoutBySessionRef.current[externalSessionId];
        delete refBridges.draftRawBySessionRef.current[externalSessionId];
        delete refBridges.draftSourceBySessionRef.current[externalSessionId];
        delete refBridges.draftMessageIdBySessionRef.current[externalSessionId];
        delete refBridges.assistantTurnTimingBySessionRef.current[externalSessionId];
        delete refBridges.turnModelBySessionRef.current[externalSessionId];
      }

      commitSessions((current) => {
        let hasChanges = false;
        const next = { ...current };
        for (const externalSessionId of externalSessionIds) {
          if (next[externalSessionId]) {
            delete next[externalSessionId];
            hasChanges = true;
          }
        }
        return hasChanges ? next : current;
      });
    },
    [commitSessions, refBridges, unsubscribersRef],
  );

  const removeAgentSession = useCallback(
    async (externalSessionId: string): Promise<void> => {
      removeSessionIds([externalSessionId]);
    },
    [removeSessionIds],
  );

  const removeAgentSessions = useCallback(
    async ({ taskId, roles }: { taskId: string; roles?: AgentRole[] }): Promise<void> => {
      const matchingRoles = roles ? new Set(roles) : null;
      const matchingSessions = Object.values(sessionsRef.current).filter(
        (session) =>
          session.taskId === taskId &&
          (matchingRoles === null || (session.role !== null && matchingRoles.has(session.role))),
      );
      const externalSessionIds = Array.from(
        new Set(matchingSessions.map((session) => session.externalSessionId)),
      );
      removeSessionIds(externalSessionIds);
    },
    [removeSessionIds, sessionsRef],
  );

  const listenToAgentSession = useCallback<ListenToAgentSession>(
    async (target): Promise<void> => {
      const externalSessionId = target.externalSessionId;
      if (unsubscribersRef.current.has(externalSessionId)) {
        return;
      }

      const unsubscribe = await listenToAgentSessionEvents({
        adapter: agentEngine,
        repoPath: target.repoPath,
        externalSessionId,
        sessionRef: target,
        sessionsRef: refBridges.sessionsRef,
        draftRawBySessionRef: refBridges.draftRawBySessionRef,
        draftSourceBySessionRef: refBridges.draftSourceBySessionRef,
        draftMessageIdBySessionRef: refBridges.draftMessageIdBySessionRef,
        draftFlushTimeoutBySessionRef: refBridges.draftFlushTimeoutBySessionRef,
        turnModelBySessionRef: refBridges.turnModelBySessionRef,
        updateSession,
        runtimeDataWriter,
        isSessionListenerActive: (candidateSessionId) =>
          candidateSessionId === externalSessionId ||
          unsubscribersRef.current.has(candidateSessionId),
        recordTurnActivityTimestamp,
        recordTurnUserMessageTimestamp,
        resolveTurnDurationMs,
        clearTurnDuration,
        buildReadOnlyApprovalRejectionMessage,
        refreshTaskData,
        resolveRuntimeDefinition: (runtimeKind: RuntimeKind) =>
          findRuntimeDefinition(agentEngine.listRuntimeDefinitions(), runtimeKind),
      });

      if (unsubscribersRef.current.has(externalSessionId)) {
        unsubscribe();
        return;
      }
      unsubscribersRef.current.set(externalSessionId, unsubscribe);
    },
    [
      agentEngine,
      buildReadOnlyApprovalRejectionMessage,
      clearTurnDuration,
      refBridges,
      refreshTaskData,
      recordTurnActivityTimestamp,
      recordTurnUserMessageTimestamp,
      resolveTurnDurationMs,
      runtimeDataWriter,
      unsubscribersRef,
      updateSession,
    ],
  );

  return { listenToAgentSession, removeAgentSession, removeAgentSessions, removeSessionIds };
};
