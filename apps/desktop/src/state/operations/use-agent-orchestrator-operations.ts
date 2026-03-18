import type { RunSummary, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentModelSelection } from "@openducktor/core";
import { useCallback, useMemo } from "react";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import type {
  AgentChatMessage,
  AgentSessionLoadOptions,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import {
  attachAgentSessionListener,
  createAgentSessionActions,
  createEnsureRuntime,
  createLoadAgentSessions,
  loadBuildContinuationTarget,
  loadRepoDefaultModel,
  loadRepoPromptOverrides,
  loadTaskDocuments,
  runOrchestratorSideEffect,
  toPersistedSessionRecord,
} from "./agent-orchestrator";
import { createOrchestratorPublicOperations } from "./agent-orchestrator/handlers/public-operations";
import type { StartAgentSessionInput } from "./agent-orchestrator/handlers/start-session";
import { useOrchestratorSessionState } from "./agent-orchestrator/hooks/use-orchestrator-session-state";
import {
  createLoadSessionModelCatalog,
  createLoadSessionTodos,
} from "./agent-orchestrator/lifecycle/session-loaders";
import { host } from "./host";

type UseAgentOrchestratorOperationsArgs = {
  activeRepo: string | null;
  tasks: TaskCard[];
  runs: RunSummary[];
  refreshTaskData: (repoPath: string) => Promise<void>;
  agentEngine: AgentEnginePort;
};

type UseAgentOrchestratorOperationsResult = {
  sessions: AgentSessionState[];
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  removeAgentSessions: (input: { taskId: string; roles?: AgentSessionState["role"][] }) => void;
  startAgentSession: (input: StartAgentSessionInput) => Promise<string>;
  forkAgentSession: (input: {
    parentSessionId: string;
    selectedModel?: AgentModelSelection | null;
  }) => Promise<string>;
  sendAgentMessage: (sessionId: string, content: string) => Promise<void>;
  stopAgentSession: (sessionId: string) => Promise<void>;
  updateAgentSessionModel: (sessionId: string, selection: AgentModelSelection | null) => void;
  replyAgentPermission: (
    sessionId: string,
    requestId: string,
    reply: "once" | "always" | "reject",
    message?: string,
  ) => Promise<void>;
  answerAgentQuestion: (sessionId: string, requestId: string, answers: string[][]) => Promise<void>;
};

export function useAgentOrchestratorOperations({
  activeRepo,
  tasks,
  runs,
  refreshTaskData,
  agentEngine,
}: UseAgentOrchestratorOperationsArgs): UseAgentOrchestratorOperationsResult {
  const { sessionsById, refBridges, commitSessions } = useOrchestratorSessionState({
    activeRepo,
    tasks,
    runs,
  });
  const { sessionsRef, turnStartedAtBySessionRef, unsubscribersRef } = refBridges;
  const runtimeDefinitions = useMemo(() => agentEngine.listRuntimeDefinitions(), [agentEngine]);

  const persistSessionSnapshot = useCallback(
    async (session: AgentSessionState): Promise<void> => {
      if (!activeRepo) {
        return;
      }
      await host.agentSessionUpsert(activeRepo, session.taskId, toPersistedSessionRecord(session));
    },
    [activeRepo],
  );

  const updateSession = useCallback(
    (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
      options?: { persist?: boolean },
    ): void => {
      const currentSessions = sessionsRef.current;
      const current = currentSessions[sessionId];
      if (!current) {
        return;
      }
      const nextSession = updater(current);
      if (nextSession === current) {
        return;
      }

      let hasChanges = false;
      for (const key of Object.keys(nextSession) as Array<keyof AgentSessionState>) {
        if (nextSession[key] !== current[key]) {
          hasChanges = true;
          break;
        }
      }

      if (!hasChanges) {
        return;
      }

      const nextSessions = {
        ...currentSessions,
        [sessionId]: nextSession,
      };
      commitSessions(nextSessions);

      if (options?.persist !== false) {
        runOrchestratorSideEffect(
          "operations-persist-session-snapshot",
          persistSessionSnapshot(nextSession),
          {
            tags: {
              repoPath: activeRepo,
              sessionId,
              taskId: nextSession.taskId,
              role: nextSession.role,
            },
          },
        );
      }
    },
    [activeRepo, commitSessions, persistSessionSnapshot, sessionsRef],
  );

  const resolveTurnDurationMs = useCallback(
    (
      sessionId: string,
      timestamp: string,
      messages: AgentChatMessage[] = [],
    ): number | undefined => {
      const parsedTimestamp = Date.parse(timestamp);
      const endedAt = Number.isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp;

      const startedAt = turnStartedAtBySessionRef.current[sessionId];
      if (typeof startedAt === "number" && endedAt >= startedAt) {
        return Math.max(0, endedAt - startedAt);
      }

      const latestUserMessage = [...messages].reverse().find((entry) => entry.role === "user");
      if (latestUserMessage) {
        const userTimestamp = Date.parse(latestUserMessage.timestamp);
        if (!Number.isNaN(userTimestamp) && endedAt >= userTimestamp) {
          return Math.max(0, endedAt - userTimestamp);
        }
      }

      return undefined;
    },
    [turnStartedAtBySessionRef],
  );

  const clearTurnDuration = useCallback(
    (sessionId: string): void => {
      delete turnStartedAtBySessionRef.current[sessionId];
    },
    [turnStartedAtBySessionRef],
  );

  const loadSessionModelCatalog = useMemo(
    () =>
      createLoadSessionModelCatalog({
        adapter: agentEngine,
        updateSession,
      }),
    [agentEngine, updateSession],
  );

  const loadSessionTodos = useMemo(
    () =>
      createLoadSessionTodos({
        adapter: agentEngine,
        supportsSessionTodos: (runtimeKind) =>
          findRuntimeDefinition(runtimeDefinitions, runtimeKind)?.capabilities.supportsTodos ??
          false,
        updateSession,
      }),
    [agentEngine, runtimeDefinitions, updateSession],
  );

  const loadAgentSessions = useMemo(
    () =>
      createLoadAgentSessions({
        activeRepo,
        adapter: agentEngine,
        repoEpochRef: refBridges.repoEpochRef,
        previousRepoRef: refBridges.previousRepoRef,
        sessionsRef: refBridges.sessionsRef,
        setSessionsById: commitSessions,
        taskRef: refBridges.taskRef,
        updateSession,
        loadSessionTodos,
        loadSessionModelCatalog,
        loadRepoPromptOverrides,
      }),
    [
      activeRepo,
      agentEngine,
      commitSessions,
      loadSessionModelCatalog,
      loadSessionTodos,
      refBridges,
      updateSession,
    ],
  );

  const removeAgentSessions = useCallback(
    ({ taskId, roles }: { taskId: string; roles?: AgentSessionState["role"][] }): void => {
      const matchingRoles = roles ? new Set(roles) : null;
      const sessionIds = Object.values(sessionsRef.current)
        .filter(
          (session) =>
            session.taskId === taskId &&
            (matchingRoles === null || matchingRoles.has(session.role)),
        )
        .map((session) => session.sessionId);
      if (sessionIds.length === 0) {
        return;
      }

      for (const sessionId of sessionIds) {
        const unsubscribe = unsubscribersRef.current.get(sessionId);
        unsubscribe?.();
        unsubscribersRef.current.delete(sessionId);

        const flushTimeout = refBridges.draftFlushTimeoutBySessionRef.current[sessionId];
        if (flushTimeout !== undefined) {
          clearTimeout(flushTimeout);
        }
        delete refBridges.draftFlushTimeoutBySessionRef.current[sessionId];
        delete refBridges.draftRawBySessionRef.current[sessionId];
        delete refBridges.draftSourceBySessionRef.current[sessionId];
        delete refBridges.draftMessageIdBySessionRef.current[sessionId];
        delete refBridges.turnStartedAtBySessionRef.current[sessionId];
        delete refBridges.turnModelBySessionRef.current[sessionId];
      }

      commitSessions((current) => {
        let hasChanges = false;
        const next = { ...current };
        for (const sessionId of sessionIds) {
          if (next[sessionId]) {
            delete next[sessionId];
            hasChanges = true;
          }
        }
        return hasChanges ? next : current;
      });
    },
    [commitSessions, refBridges, sessionsRef, unsubscribersRef],
  );

  const attachSessionListener = useCallback(
    (repoPath: string, sessionId: string): void => {
      const unsubscribe = attachAgentSessionListener({
        adapter: agentEngine,
        repoPath,
        sessionId,
        sessionsRef: refBridges.sessionsRef,
        draftRawBySessionRef: refBridges.draftRawBySessionRef,
        draftSourceBySessionRef: refBridges.draftSourceBySessionRef,
        draftMessageIdBySessionRef: refBridges.draftMessageIdBySessionRef,
        draftFlushTimeoutBySessionRef: refBridges.draftFlushTimeoutBySessionRef,
        turnStartedAtBySessionRef: refBridges.turnStartedAtBySessionRef,
        turnModelBySessionRef: refBridges.turnModelBySessionRef,
        updateSession,
        resolveTurnDurationMs,
        clearTurnDuration,
        refreshTaskData,
        loadSessionTodos,
      });

      unsubscribersRef.current.set(sessionId, unsubscribe);
    },
    [
      agentEngine,
      clearTurnDuration,
      loadSessionTodos,
      refBridges,
      refreshTaskData,
      resolveTurnDurationMs,
      unsubscribersRef,
      updateSession,
    ],
  );

  const ensureRuntime = useMemo(
    () =>
      createEnsureRuntime({
        runsRef: refBridges.runsRef,
        refreshTaskData,
      }),
    [refBridges, refreshTaskData],
  );

  const sessionActions = useMemo(
    () =>
      createAgentSessionActions({
        activeRepo,
        adapter: agentEngine,
        setSessionsById: commitSessions,
        sessionsRef: refBridges.sessionsRef,
        taskRef: refBridges.taskRef,
        repoEpochRef: refBridges.repoEpochRef,
        previousRepoRef: refBridges.previousRepoRef,
        inFlightStartsByRepoTaskRef: refBridges.inFlightStartsByRepoTaskRef,
        unsubscribersRef: refBridges.unsubscribersRef,
        turnStartedAtBySessionRef: refBridges.turnStartedAtBySessionRef,
        turnModelBySessionRef: refBridges.turnModelBySessionRef,
        updateSession,
        attachSessionListener,
        resolveBuildContinuationTarget: async (repoPath, taskId) =>
          (await loadBuildContinuationTarget(repoPath, taskId)).workingDirectory,
        ensureRuntime,
        loadTaskDocuments,
        loadRepoDefaultModel,
        loadSessionTodos,
        loadSessionModelCatalog,
        loadRepoPromptOverrides,
        loadAgentSessions,
        clearTurnDuration,
        refreshTaskData,
        persistSessionSnapshot,
      }),
    [
      activeRepo,
      agentEngine,
      attachSessionListener,
      clearTurnDuration,
      commitSessions,
      ensureRuntime,
      loadAgentSessions,
      loadSessionModelCatalog,
      loadSessionTodos,
      persistSessionSnapshot,
      refBridges,
      refreshTaskData,
      updateSession,
    ],
  );

  return useMemo<UseAgentOrchestratorOperationsResult>(
    () =>
      createOrchestratorPublicOperations({
        sessionsById,
        loadAgentSessions,
        removeAgentSessions,
        sessionActions,
      }),
    [sessionsById, loadAgentSessions, removeAgentSessions, sessionActions],
  );
}
