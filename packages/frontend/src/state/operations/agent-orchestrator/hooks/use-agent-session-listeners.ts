import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort, AgentRole } from "@openducktor/core";
import { useCallback } from "react";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { attachAgentSessionListener } from "../events/session-events";
import { isTranscriptAgentSession } from "../support/session-purpose";
import type { UpdateAgentSession } from "./use-agent-session-mutations";
import type { useOrchestratorSessionState } from "./use-orchestrator-session-state";

type RefBridges = ReturnType<typeof useOrchestratorSessionState>["refBridges"];

type UseAgentSessionListenersArgs = {
  agentEngine: AgentEnginePort;
  refBridges: RefBridges;
  sessionsRef: { current: Record<string, AgentSessionState> };
  commitSessions: (
    updater:
      | Record<string, AgentSessionState>
      | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
  ) => void;
  updateSession: UpdateAgentSession;
  recordTurnActivityTimestamp: (externalSessionId: string, timestamp: string | number) => void;
  recordTurnUserMessageTimestamp: (externalSessionId: string, timestamp: string | number) => void;
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
  refBridges,
  sessionsRef,
  commitSessions,
  updateSession,
  recordTurnActivityTimestamp,
  recordTurnUserMessageTimestamp,
  resolveTurnDurationMs,
  clearTurnDuration,
  refreshTaskData,
}: UseAgentSessionListenersArgs) => {
  const { unsubscribersRef } = refBridges;

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
      const session = sessionsRef.current[externalSessionId];
      if (
        session &&
        isTranscriptAgentSession(session) &&
        agentEngine.hasSession(externalSessionId)
      ) {
        await agentEngine.detachSession(externalSessionId);
      }
      removeSessionIds([externalSessionId]);
    },
    [agentEngine, removeSessionIds, sessionsRef],
  );

  const removeAgentSessions = useCallback(
    async ({ taskId, roles }: { taskId: string; roles?: AgentRole[] }): Promise<void> => {
      const matchingRoles = roles ? new Set(roles) : null;
      const matchingSessions = Object.values(sessionsRef.current).filter(
        (session) =>
          session.taskId === taskId &&
          (matchingRoles === null || (session.role !== null && matchingRoles.has(session.role))),
      );
      await Promise.all(
        matchingSessions.map(async (session) => {
          if (
            isTranscriptAgentSession(session) &&
            agentEngine.hasSession(session.externalSessionId)
          ) {
            await agentEngine.detachSession(session.externalSessionId);
          }
        }),
      );
      const externalSessionIds = matchingSessions
        .filter(
          (session, index, sessions) =>
            sessions.findIndex(
              (candidate) => candidate.externalSessionId === session.externalSessionId,
            ) === index,
        )
        .map((session) => session.externalSessionId);
      removeSessionIds(externalSessionIds);
    },
    [agentEngine, removeSessionIds, sessionsRef],
  );

  const attachSessionListener = useCallback(
    (repoPath: string, externalSessionId: string): void => {
      if (unsubscribersRef.current.has(externalSessionId)) {
        return;
      }
      const unsubscribe = attachAgentSessionListener({
        adapter: agentEngine,
        repoPath,
        externalSessionId,
        sessionsRef: refBridges.sessionsRef,
        draftRawBySessionRef: refBridges.draftRawBySessionRef,
        draftSourceBySessionRef: refBridges.draftSourceBySessionRef,
        draftMessageIdBySessionRef: refBridges.draftMessageIdBySessionRef,
        draftFlushTimeoutBySessionRef: refBridges.draftFlushTimeoutBySessionRef,
        turnStartedAtBySessionRef: refBridges.turnStartedAtBySessionRef,
        turnModelBySessionRef: refBridges.turnModelBySessionRef,
        updateSession,
        isSessionListenerAttached: (candidateSessionId) =>
          candidateSessionId === externalSessionId ||
          unsubscribersRef.current.has(candidateSessionId),
        recordTurnActivityTimestamp,
        recordTurnUserMessageTimestamp,
        resolveTurnDurationMs,
        clearTurnDuration,
        refreshTaskData,
        resolveRuntimeDefinition: (runtimeKind: RuntimeKind) =>
          findRuntimeDefinition(agentEngine.listRuntimeDefinitions(), runtimeKind),
      });

      unsubscribersRef.current.set(externalSessionId, unsubscribe);
    },
    [
      agentEngine,
      clearTurnDuration,
      refBridges,
      refreshTaskData,
      recordTurnActivityTimestamp,
      recordTurnUserMessageTimestamp,
      resolveTurnDurationMs,
      unsubscribersRef,
      updateSession,
    ],
  );

  return { attachSessionListener, removeAgentSession, removeAgentSessions, removeSessionIds };
};
