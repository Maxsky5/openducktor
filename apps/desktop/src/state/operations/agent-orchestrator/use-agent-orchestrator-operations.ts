import type { RunSummary, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentModelSelection } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { appQueryClient } from "@/lib/query-client";
import type {
  AgentChatMessage,
  AgentSessionLoadOptions,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { loadAgentSessionListFromQuery } from "../../queries/agent-sessions";
import { loadRuntimeListFromQuery } from "../../queries/runtime";
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
import { createLoadSessionModelCatalog, createLoadSessionTodos } from "./lifecycle/session-loaders";
import { resolveRuntimeRouteConnection } from "./runtime/runtime";

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

const getOrCreateRepoTaskSet = (
  store: Record<string, Set<string>>,
  repoPath: string,
): Set<string> => {
  const existing = store[repoPath];
  if (existing) {
    return existing;
  }
  const created = new Set<string>();
  store[repoPath] = created;
  return created;
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
  const bootstrappedTasksByRepoRef = useRef<Record<string, Set<string>>>({});
  const reconciledLiveSessionTasksByRepoRef = useRef<Record<string, Set<string>>>({});
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
        attachSessionListener,
        loadSessionTodos,
        loadSessionModelCatalog,
        loadRepoPromptOverrides,
        loadTaskDocuments,
      }),
    [
      activeRepo,
      agentEngine,
      attachSessionListener,
      commitSessions,
      loadSessionModelCatalog,
      loadSessionTodos,
      refBridges,
      updateSession,
    ],
  );

  useEffect(() => {
    if (!activeRepo) {
      return;
    }
    bootstrappedTasksByRepoRef.current[activeRepo] = new Set<string>();
    reconciledLiveSessionTasksByRepoRef.current[activeRepo] = new Set<string>();
  }, [activeRepo]);

  useEffect(() => {
    if (!activeRepo) {
      return;
    }

    const bootstrappedTasks = getOrCreateRepoTaskSet(
      bootstrappedTasksByRepoRef.current,
      activeRepo,
    );
    const pendingTaskIds = tasks
      .map((task) => task.id)
      .filter((taskId) => !bootstrappedTasks.has(taskId));
    if (pendingTaskIds.length === 0) {
      return;
    }

    for (const taskId of pendingTaskIds) {
      bootstrappedTasks.add(taskId);
      void loadAgentSessions(taskId).catch(() => {
        const currentSet = bootstrappedTasksByRepoRef.current[activeRepo];
        currentSet?.delete(taskId);
      });
    }
  }, [activeRepo, loadAgentSessions, tasks]);

  useEffect(() => {
    if (!activeRepo || tasks.length === 0) {
      return;
    }
    const reconciledTaskIds = getOrCreateRepoTaskSet(
      reconciledLiveSessionTasksByRepoRef.current,
      activeRepo,
    );
    const pendingTaskIds = tasks
      .map((task) => task.id)
      .filter((taskId) => !reconciledTaskIds.has(taskId));
    if (pendingTaskIds.length === 0) {
      return;
    }

    let cancelled = false;
    const activeRunStates = new Set<RunSummary["state"]>([
      "starting",
      "running",
      "blocked",
      "awaiting_done_confirmation",
    ]);

    void (async () => {
      try {
        const persistedByTask = await Promise.all(
          pendingTaskIds.map(
            async (taskId) =>
              [
                taskId,
                await loadAgentSessionListFromQuery(appQueryClient, activeRepo, taskId, {
                  forceFresh: true,
                }),
              ] as const,
          ),
        );
        if (cancelled) {
          return;
        }

        const persistedTaskIdsByLiveSessionKey = new Map<string, Set<string>>();
        const runtimeKinds = new Set<string>();
        for (const [taskId, records] of persistedByTask) {
          for (const record of records) {
            const runtimeKind = record.runtimeKind ?? record.selectedModel?.runtimeKind;
            const externalSessionId = record.externalSessionId ?? record.sessionId;
            if (!runtimeKind || !externalSessionId) {
              continue;
            }
            runtimeKinds.add(runtimeKind);
            const key = `${runtimeKind}::${externalSessionId}`;
            const taskIds = persistedTaskIdsByLiveSessionKey.get(key) ?? new Set<string>();
            taskIds.add(taskId);
            persistedTaskIdsByLiveSessionKey.set(key, taskIds);
          }
        }

        if (persistedTaskIdsByLiveSessionKey.size === 0) {
          const currentSet = getOrCreateRepoTaskSet(
            reconciledLiveSessionTasksByRepoRef.current,
            activeRepo,
          );
          for (const taskId of pendingTaskIds) {
            currentSet.add(taskId);
          }
          return;
        }

        const runtimeConnections = new Map<
          string,
          Parameters<AgentEnginePort["listRuntimeSessions"]>[0]
        >();
        for (const runtimeKind of runtimeKinds) {
          const runtimes = await loadRuntimeListFromQuery(appQueryClient, runtimeKind, activeRepo);
          if (cancelled) {
            return;
          }
          for (const runtime of runtimes) {
            const { runtimeConnection } = resolveRuntimeRouteConnection(
              runtime.runtimeRoute,
              runtime.workingDirectory,
            );
            const key = `${runtimeKind}::${runtimeConnection.endpoint}::${runtimeConnection.workingDirectory}`;
            runtimeConnections.set(key, {
              runtimeKind,
              runtimeConnection,
            });
          }
        }

        for (const run of runs) {
          if (!activeRunStates.has(run.state)) {
            continue;
          }
          const { runtimeConnection } = resolveRuntimeRouteConnection(
            run.runtimeRoute,
            run.worktreePath,
          );
          const key = `${run.runtimeKind}::${runtimeConnection.endpoint}::${runtimeConnection.workingDirectory}`;
          runtimeConnections.set(key, {
            runtimeKind: run.runtimeKind,
            runtimeConnection,
          });
        }

        const taskIdsToReconcile = new Set<string>();
        for (const input of runtimeConnections.values()) {
          const runtimeSessions = await agentEngine.listRuntimeSessions(input);
          if (cancelled) {
            return;
          }
          for (const runtimeSession of runtimeSessions) {
            if (runtimeSession.status.type !== "busy" && runtimeSession.status.type !== "retry") {
              continue;
            }
            const key = `${input.runtimeKind}::${runtimeSession.externalSessionId}`;
            const taskIds = persistedTaskIdsByLiveSessionKey.get(key);
            if (!taskIds) {
              continue;
            }
            for (const taskId of taskIds) {
              taskIdsToReconcile.add(taskId);
            }
          }
        }

        if (cancelled) {
          return;
        }

        await Promise.all(
          Array.from(taskIdsToReconcile).map((taskId) =>
            loadAgentSessions(taskId, { reconcileLiveSessions: true }),
          ),
        );
        if (cancelled) {
          return;
        }
        const currentSet = getOrCreateRepoTaskSet(
          reconciledLiveSessionTasksByRepoRef.current,
          activeRepo,
        );
        for (const taskId of pendingTaskIds) {
          currentSet.add(taskId);
        }
      } catch {
        // Leave pending tasks unreconciled so a later render can retry.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeRepo, agentEngine, loadAgentSessions, runs, tasks]);

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
