import type {
  AgentSessionRecord,
  RunSummary,
  RuntimeInstanceSummary,
  RuntimeKind,
  TaskCard,
} from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentRuntimeConnection,
  AgentSessionTodoItem,
  AgentSlashCommandCatalog,
  AgentUserMessagePart,
} from "@openducktor/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { appQueryClient } from "@/lib/query-client";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { runtimeQueryKeys } from "@/state/queries/runtime";
import { invalidateRepoTaskQueries } from "@/state/queries/tasks";
import type {
  AgentChatMessage,
  AgentSessionLoadOptions,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { upsertAgentSessionRecordInQuery } from "../../queries/agent-sessions";
import { upsertAgentSessionInRepoTaskData } from "../../queries/tasks";
import { host } from "../shared/host";
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
} from ".";
import { createOrchestratorPublicOperations } from "./handlers/public-operations";
import type { StartAgentSessionInput } from "./handlers/start-session";
import { useOrchestratorSessionState } from "./hooks/use-orchestrator-session-state";
import { LiveAgentSessionStore } from "./lifecycle/live-agent-session-store";
import { createRepoSessionHydrationService } from "./lifecycle/repo-session-hydration-service";
import { createSessionHydrationOperations } from "./lifecycle/session-hydration-operations";

type UseAgentOrchestratorOperationsArgs = {
  activeRepo: string | null;
  tasks: TaskCard[];
  runs: RunSummary[];
  refreshTaskData: (repoPath: string, taskId?: string) => Promise<void>;
  agentEngine: AgentEnginePort;
};

type UseAgentOrchestratorOperationsResult = {
  sessions: AgentSessionState[];
  bootstrapTaskSessions: (taskId: string, persistedRecords?: AgentSessionRecord[]) => Promise<void>;
  hydrateRequestedTaskSessionHistory: (input: {
    taskId: string;
    sessionId: string;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<void>;
  reconcileLiveTaskSessions: (input: {
    taskId: string;
    persistedRecords?: AgentSessionRecord[];
    preloadedRuns?: RunSummary[];
    preloadedRuntimeLists?: Map<RuntimeKind, RuntimeInstanceSummary[]>;
    preloadedRuntimeConnectionsByKey?: Map<
      string,
      import("@openducktor/core").AgentRuntimeConnection
    >;
    preloadedLiveAgentSessionsByKey?: Map<
      string,
      import("@openducktor/core").LiveAgentSessionSnapshot[]
    >;
    allowRuntimeEnsure?: boolean;
  }) => Promise<void>;
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  readSessionModelCatalog: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) => Promise<AgentSessionTodoItem[]>;
  readSessionSlashCommands: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
  ) => Promise<AgentSlashCommandCatalog>;
  readSessionFileSearch: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
  removeAgentSessions: (input: { taskId: string; roles?: AgentSessionState["role"][] }) => void;
  startAgentSession: (input: StartAgentSessionInput) => Promise<string>;
  sendAgentMessage: (sessionId: string, parts: AgentUserMessagePart[]) => Promise<void>;
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
  const [sessionRetryTick, setSessionRetryTick] = useState(0);

  const persistSessionRecord = useCallback(
    async (taskId: string, record: AgentSessionRecord): Promise<void> => {
      if (!activeRepo) {
        return;
      }
      await host.agentSessionUpsert(activeRepo, taskId, record);
      upsertAgentSessionRecordInQuery(appQueryClient, activeRepo, taskId, record);
      upsertAgentSessionInRepoTaskData(appQueryClient, activeRepo, taskId, record);
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

      if (options?.persist === true) {
        runOrchestratorSideEffect(
          "operations-persist-session-snapshot",
          persistSessionRecord(nextSession.taskId, toPersistedSessionRecord(nextSession)),
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
    [activeRepo, commitSessions, persistSessionRecord, sessionsRef],
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

  const readSessionModelCatalog = useCallback(
    (runtimeKind: RuntimeKind, runtimeConnection: AgentRuntimeConnection) =>
      agentEngine.listAvailableModels({
        runtimeKind,
        runtimeConnection,
      }),
    [agentEngine],
  );

  const readSessionTodos = useCallback(
    (
      runtimeKind: RuntimeKind,
      runtimeConnection: AgentRuntimeConnection,
      externalSessionId: string,
    ) =>
      agentEngine.loadSessionTodos({
        runtimeKind,
        runtimeConnection,
        externalSessionId,
      }),
    [agentEngine],
  );

  const readSessionSlashCommands = useCallback(
    (runtimeKind: RuntimeKind, runtimeConnection: AgentRuntimeConnection) =>
      agentEngine.listAvailableSlashCommands({
        runtimeKind,
        runtimeConnection,
      }),
    [agentEngine],
  );

  const readSessionFileSearch = useCallback(
    (runtimeKind: RuntimeKind, runtimeConnection: AgentRuntimeConnection, query: string) =>
      agentEngine.searchFiles({
        runtimeKind,
        runtimeConnection,
        query,
      }),
    [agentEngine],
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

  const liveAgentSessionStore = useMemo(() => new LiveAgentSessionStore(), []);

  const attachSessionListener = useCallback(
    (repoPath: string, sessionId: string): void => {
      if (unsubscribersRef.current.has(sessionId)) {
        return;
      }
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
      });

      unsubscribersRef.current.set(sessionId, unsubscribe);
    },
    [
      agentEngine,
      clearTurnDuration,
      refBridges,
      refreshTaskData,
      resolveTurnDurationMs,
      unsubscribersRef,
      updateSession,
    ],
  );

  const loadAgentSessions = useMemo(
    () =>
      createLoadAgentSessions({
        activeRepo,
        adapter: agentEngine,
        repoEpochRef: refBridges.repoEpochRef,
        activeRepoRef: refBridges.activeRepoRef,
        previousRepoRef: refBridges.previousRepoRef,
        sessionsRef: refBridges.sessionsRef,
        setSessionsById: commitSessions,
        taskRef: refBridges.taskRef,
        updateSession,
        attachSessionListener,
        loadRepoPromptOverrides,
        loadTaskDocuments,
        liveAgentSessionStore,
      }),
    [
      activeRepo,
      agentEngine,
      attachSessionListener,
      commitSessions,
      liveAgentSessionStore,
      refBridges,
      updateSession,
    ],
  );

  const sessionHydration = useMemo(
    () =>
      createSessionHydrationOperations({
        loadAgentSessions,
      }),
    [loadAgentSessions],
  );

  const repoSessionHydrationService = useMemo(
    () =>
      createRepoSessionHydrationService({
        agentEngine,
        sessionHydration,
        liveAgentSessionStore,
        onRetryRequested: () => {
          setSessionRetryTick((current) => current + 1);
        },
      }),
    [agentEngine, liveAgentSessionStore, sessionHydration],
  );

  const isCurrentActiveRepo = useCallback(
    (repoPath: string): boolean => refBridges.activeRepoRef.current === repoPath,
    [refBridges],
  );

  useEffect(() => {
    return () => repoSessionHydrationService.dispose();
  }, [repoSessionHydrationService]);

  useEffect(() => {
    if (!activeRepo) {
      return;
    }
    repoSessionHydrationService.resetRepo(activeRepo);
  }, [activeRepo, repoSessionHydrationService]);

  useEffect(() => {
    if (!activeRepo) {
      return;
    }
    // Explicitly reference the retry tick: this effect must rerun when a delayed retry fires.
    void sessionRetryTick;

    let cancelled = false;

    void (async () => {
      await repoSessionHydrationService.bootstrapPendingTasks({
        repoPath: activeRepo,
        tasks,
        isCancelled: () => cancelled,
        isCurrentRepo: isCurrentActiveRepo,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [activeRepo, isCurrentActiveRepo, repoSessionHydrationService, sessionRetryTick, tasks]);

  useEffect(() => {
    if (!activeRepo || tasks.length === 0) {
      return;
    }
    // Explicitly reference the retry tick: this effect must rerun when a delayed retry fires.
    void sessionRetryTick;
    let cancelled = false;

    void (async () => {
      await repoSessionHydrationService.reconcilePendingTasks({
        repoPath: activeRepo,
        tasks,
        runs,
        isCancelled: () => cancelled,
        isCurrentRepo: isCurrentActiveRepo,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [activeRepo, isCurrentActiveRepo, runs, repoSessionHydrationService, sessionRetryTick, tasks]);

  const ensureRuntime = useMemo(
    () =>
      createEnsureRuntime({
        runsRef: refBridges.runsRef,
        refreshTaskData,
      }),
    [refBridges, refreshTaskData],
  );

  const invalidateSessionStopQueries = useCallback(
    async ({
      repoPath,
      taskId,
      runtimeKind,
    }: {
      repoPath: string;
      taskId: string;
      runtimeKind?: RuntimeKind;
    }): Promise<void> => {
      await Promise.all([
        invalidateRepoTaskQueries(appQueryClient, repoPath),
        appQueryClient.invalidateQueries({
          queryKey: agentSessionQueryKeys.list(repoPath, taskId),
          exact: true,
          refetchType: "none",
        }),
        ...(runtimeKind
          ? [
              appQueryClient.invalidateQueries({
                queryKey: runtimeQueryKeys.list(runtimeKind, repoPath),
                exact: true,
                refetchType: "none",
              }),
            ]
          : []),
      ]);
    },
    [],
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
        activeRepoRef: refBridges.activeRepoRef,
        previousRepoRef: refBridges.previousRepoRef,
        inFlightStartsByRepoTaskRef: refBridges.inFlightStartsByRepoTaskRef,
        unsubscribersRef: refBridges.unsubscribersRef,
        turnStartedAtBySessionRef: refBridges.turnStartedAtBySessionRef,
        turnModelBySessionRef: refBridges.turnModelBySessionRef,
        updateSession,
        attachSessionListener,
        resolveBuildContinuationTarget: async (repoPath, taskId) =>
          loadBuildContinuationTarget(repoPath, taskId),
        ensureRuntime,
        loadTaskDocuments,
        loadRepoDefaultModel,
        loadRepoPromptOverrides,
        loadAgentSessions,
        clearTurnDuration,
        refreshTaskData,
        persistSessionRecord,
        stopBuildRun: async (runId) => {
          await host.buildStop(runId);
        },
        invalidateSessionStopQueries,
      }),
    [
      activeRepo,
      agentEngine,
      attachSessionListener,
      clearTurnDuration,
      commitSessions,
      ensureRuntime,
      loadAgentSessions,
      invalidateSessionStopQueries,
      persistSessionRecord,
      refBridges,
      refreshTaskData,
      updateSession,
    ],
  );

  return useMemo<UseAgentOrchestratorOperationsResult>(
    () =>
      createOrchestratorPublicOperations({
        sessionsById,
        bootstrapTaskSessions: sessionHydration.bootstrapTaskSessions,
        hydrateRequestedTaskSessionHistory: sessionHydration.hydrateRequestedTaskSession,
        reconcileLiveTaskSessions: sessionHydration.reconcileLiveTaskSessions,
        loadAgentSessions,
        readSessionModelCatalog,
        readSessionTodos,
        readSessionSlashCommands,
        readSessionFileSearch,
        removeAgentSessions,
        sessionActions,
      }),
    [
      sessionsById,
      sessionHydration,
      loadAgentSessions,
      readSessionModelCatalog,
      readSessionTodos,
      readSessionSlashCommands,
      readSessionFileSearch,
      removeAgentSessions,
      sessionActions,
    ],
  );
}
