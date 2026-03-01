import type { RunSummary, TaskCard } from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentModelSelection,
  AgentRole,
  AgentScenario,
} from "@openducktor/core";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
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
  loadRepoDefaultModel,
  loadTaskDocuments,
  mergeTodoListPreservingOrder,
  normalizeSelectionForCatalog,
  now,
  pickDefaultModel,
  runOrchestratorSideEffect,
  toPersistedSessionRecord,
  upsertMessage,
} from "./agent-orchestrator";
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
  startAgentSession: (input: {
    taskId: string;
    role: AgentRole;
    scenario?: AgentScenario;
    selectedModel?: AgentModelSelection | null;
    sendKickoff?: boolean;
    startMode?: "reuse_latest" | "fresh";
    requireModelReady?: boolean;
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

type OrchestratorRefs = {
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  taskRef: MutableRefObject<TaskCard[]>;
  runsRef: MutableRefObject<RunSummary[]>;
  previousRepoRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
  inFlightStartsByRepoTaskRef: MutableRefObject<Map<string, Promise<string>>>;
  unsubscribersRef: MutableRefObject<Map<string, () => void>>;
  draftRawBySessionRef: MutableRefObject<Record<string, string>>;
  draftSourceBySessionRef: MutableRefObject<Record<string, "delta" | "part">>;
  turnStartedAtBySessionRef: MutableRefObject<Record<string, number>>;
};

const createMutableRef = <T>(value: T): MutableRefObject<T> => ({
  current: value,
});

export function useAgentOrchestratorOperations({
  activeRepo,
  tasks,
  runs,
  refreshTaskData,
  agentEngine,
}: UseAgentOrchestratorOperationsArgs): UseAgentOrchestratorOperationsResult {
  const [sessionsById, setSessionsById] = useState<Record<string, AgentSessionState>>({});
  const orchestratorRefs = useRef<OrchestratorRefs>({
    sessionsRef: createMutableRef<Record<string, AgentSessionState>>({}),
    taskRef: createMutableRef<TaskCard[]>(tasks),
    runsRef: createMutableRef<RunSummary[]>(runs),
    previousRepoRef: createMutableRef<string | null>(null),
    repoEpochRef: createMutableRef(0),
    inFlightStartsByRepoTaskRef: createMutableRef(new Map<string, Promise<string>>()),
    unsubscribersRef: createMutableRef(new Map<string, () => void>()),
    draftRawBySessionRef: createMutableRef<Record<string, string>>({}),
    draftSourceBySessionRef: createMutableRef<Record<string, "delta" | "part">>({}),
    turnStartedAtBySessionRef: createMutableRef<Record<string, number>>({}),
  });

  useEffect(() => {
    orchestratorRefs.current.sessionsRef.current = sessionsById;
    orchestratorRefs.current.taskRef.current = tasks;
    orchestratorRefs.current.runsRef.current = runs;
  }, [runs, sessionsById, tasks]);

  useEffect(() => {
    if (orchestratorRefs.current.previousRepoRef.current === activeRepo) {
      return;
    }
    orchestratorRefs.current.repoEpochRef.current += 1;
    orchestratorRefs.current.previousRepoRef.current = activeRepo;

    const unsubs = [...orchestratorRefs.current.unsubscribersRef.current.values()];
    for (const unsubscribe of unsubs) {
      unsubscribe();
    }
    orchestratorRefs.current.unsubscribersRef.current.clear();
    orchestratorRefs.current.draftRawBySessionRef.current = {};
    orchestratorRefs.current.draftSourceBySessionRef.current = {};
    orchestratorRefs.current.turnStartedAtBySessionRef.current = {};
    orchestratorRefs.current.inFlightStartsByRepoTaskRef.current.clear();
    orchestratorRefs.current.sessionsRef.current = {};
    setSessionsById({});
  }, [activeRepo]);

  const persistSessionSnapshot = useCallback(
    async (session: AgentSessionState): Promise<void> => {
      if (!activeRepo) {
        return;
      }
      const updatedAt = now();
      await host.agentSessionUpsert(
        activeRepo,
        session.taskId,
        toPersistedSessionRecord(session, updatedAt),
      );
    },
    [activeRepo],
  );

  const updateSession = useCallback(
    (
      sessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
      options?: { persist?: boolean },
    ): void => {
      const currentSessions = orchestratorRefs.current.sessionsRef.current;
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
      orchestratorRefs.current.sessionsRef.current = nextSessions;
      setSessionsById(nextSessions);

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
    [activeRepo, persistSessionSnapshot],
  );

  const resolveTurnDurationMs = useCallback(
    (
      sessionId: string,
      timestamp: string,
      messages: AgentChatMessage[] = [],
    ): number | undefined => {
      const parsedTimestamp = Date.parse(timestamp);
      const endedAt = Number.isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp;

      const startedAt = orchestratorRefs.current.turnStartedAtBySessionRef.current[sessionId];
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
    [],
  );

  const clearTurnDuration = useCallback((sessionId: string): void => {
    delete orchestratorRefs.current.turnStartedAtBySessionRef.current[sessionId];
  }, []);

  const loadSessionModelCatalog = useCallback(
    async (sessionId: string, baseUrl: string, workingDirectory: string): Promise<void> => {
      updateSession(
        sessionId,
        (current) => ({
          ...current,
          isLoadingModelCatalog: true,
        }),
        { persist: false },
      );

      try {
        const catalog = await agentEngine.listAvailableModels({
          baseUrl,
          workingDirectory,
        });
        updateSession(
          sessionId,
          (current) => ({
            ...current,
            modelCatalog: catalog,
            selectedModel:
              normalizeSelectionForCatalog(catalog, current.selectedModel) ??
              pickDefaultModel(catalog),
            isLoadingModelCatalog: false,
          }),
          { persist: false },
        );
      } catch (error) {
        updateSession(
          sessionId,
          (current) => ({
            ...current,
            isLoadingModelCatalog: false,
            messages: upsertMessage(current.messages, {
              id: `model-catalog:${sessionId}`,
              role: "system",
              content: `Model catalog unavailable: ${errorMessage(error)}`,
              timestamp: now(),
            }),
          }),
          { persist: false },
        );
      }
    },
    [agentEngine, updateSession],
  );

  const loadSessionTodos = useCallback(
    async (
      sessionId: string,
      baseUrl: string,
      workingDirectory: string,
      externalSessionId: string,
    ): Promise<void> => {
      const todos = await agentEngine.loadSessionTodos({
        baseUrl,
        workingDirectory,
        externalSessionId,
      });
      updateSession(
        sessionId,
        (current) => ({
          ...current,
          todos: mergeTodoListPreservingOrder(current.todos, todos),
        }),
        { persist: false },
      );
    },
    [agentEngine, updateSession],
  );

  const loadAgentSessions = useMemo(
    () =>
      createLoadAgentSessions({
        activeRepo,
        adapter: agentEngine,
        repoEpochRef: orchestratorRefs.current.repoEpochRef,
        previousRepoRef: orchestratorRefs.current.previousRepoRef,
        sessionsRef: orchestratorRefs.current.sessionsRef,
        setSessionsById,
        taskRef: orchestratorRefs.current.taskRef,
        updateSession,
        loadSessionTodos,
        loadSessionModelCatalog,
      }),
    [activeRepo, agentEngine, loadSessionModelCatalog, loadSessionTodos, updateSession],
  );

  const attachSessionListener = useCallback(
    (repoPath: string, sessionId: string): void => {
      const unsubscribe = attachAgentSessionListener({
        adapter: agentEngine,
        repoPath,
        sessionId,
        sessionsRef: orchestratorRefs.current.sessionsRef,
        draftRawBySessionRef: orchestratorRefs.current.draftRawBySessionRef,
        draftSourceBySessionRef: orchestratorRefs.current.draftSourceBySessionRef,
        turnStartedAtBySessionRef: orchestratorRefs.current.turnStartedAtBySessionRef,
        updateSession,
        resolveTurnDurationMs,
        clearTurnDuration,
        refreshTaskData,
        loadSessionTodos,
      });

      orchestratorRefs.current.unsubscribersRef.current.set(sessionId, unsubscribe);
    },
    [
      agentEngine,
      clearTurnDuration,
      loadSessionTodos,
      refreshTaskData,
      resolveTurnDurationMs,
      updateSession,
    ],
  );

  const ensureRuntime = useMemo(
    () =>
      createEnsureRuntime({
        runsRef: orchestratorRefs.current.runsRef,
        refreshTaskData,
      }),
    [refreshTaskData],
  );

  const sessionActions = useMemo(
    () =>
      createAgentSessionActions({
        activeRepo,
        adapter: agentEngine,
        setSessionsById,
        sessionsRef: orchestratorRefs.current.sessionsRef,
        taskRef: orchestratorRefs.current.taskRef,
        repoEpochRef: orchestratorRefs.current.repoEpochRef,
        previousRepoRef: orchestratorRefs.current.previousRepoRef,
        inFlightStartsByRepoTaskRef: orchestratorRefs.current.inFlightStartsByRepoTaskRef,
        unsubscribersRef: orchestratorRefs.current.unsubscribersRef,
        turnStartedAtBySessionRef: orchestratorRefs.current.turnStartedAtBySessionRef,
        updateSession,
        attachSessionListener,
        ensureRuntime,
        loadTaskDocuments,
        loadRepoDefaultModel,
        loadSessionTodos,
        loadSessionModelCatalog,
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
      ensureRuntime,
      loadAgentSessions,
      loadSessionModelCatalog,
      loadSessionTodos,
      persistSessionSnapshot,
      refreshTaskData,
      updateSession,
    ],
  );

  useEffect(() => {
    return () => {
      const unsubs = [...orchestratorRefs.current.unsubscribersRef.current.values()];
      for (const unsubscribe of unsubs) {
        unsubscribe();
      }
      orchestratorRefs.current.unsubscribersRef.current.clear();
      orchestratorRefs.current.inFlightStartsByRepoTaskRef.current.clear();
    };
  }, []);

  const sessions = useMemo(
    () =>
      Object.values(sessionsById).sort((a, b) =>
        a.startedAt > b.startedAt ? -1 : a.startedAt < b.startedAt ? 1 : 0,
      ),
    [sessionsById],
  );

  return {
    sessions,
    loadAgentSessions: async (taskId, options) => {
      try {
        await loadAgentSessions(taskId, options);
      } catch (error) {
        toast.error("Failed to load agent sessions", {
          description: errorMessage(error),
        });
      }
    },
    startAgentSession: async (input) => {
      try {
        return await sessionActions.startAgentSession(input);
      } catch (error) {
        toast.error("Failed to start agent session", {
          description: errorMessage(error),
        });
        throw error;
      }
    },
    sendAgentMessage: async (sessionId, content) => {
      try {
        await sessionActions.sendAgentMessage(sessionId, content);
      } catch (error) {
        toast.error("Failed to send message", {
          description: errorMessage(error),
        });
        throw error;
      }
    },
    stopAgentSession: sessionActions.stopAgentSession,
    updateAgentSessionModel: sessionActions.updateAgentSessionModel,
    replyAgentPermission: sessionActions.replyAgentPermission,
    answerAgentQuestion: sessionActions.answerAgentQuestion,
  };
}
