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

type SessionStateById = Record<string, AgentSessionState>;
type SessionStateUpdater = SessionStateById | ((current: SessionStateById) => SessionStateById);

type OrchestratorMutableState = {
  sessionsById: SessionStateById;
  tasks: TaskCard[];
  runs: RunSummary[];
  previousRepo: string | null;
  repoEpoch: number;
  inFlightStartsByRepoTask: Map<string, Promise<string>>;
  unsubscribersBySession: Map<string, () => void>;
  draftRawBySession: Record<string, string>;
  draftSourceBySession: Record<string, "delta" | "part">;
  turnStartedAtBySession: Record<string, number>;
};

type OrchestratorRefBridges = {
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

const createMutableBridge = <K extends keyof OrchestratorMutableState>(
  stateRef: MutableRefObject<OrchestratorMutableState>,
  key: K,
): MutableRefObject<OrchestratorMutableState[K]> =>
  ({
    get current() {
      return stateRef.current[key];
    },
    set current(value: OrchestratorMutableState[K]) {
      stateRef.current[key] = value;
    },
  }) as MutableRefObject<OrchestratorMutableState[K]>;

export function useAgentOrchestratorOperations({
  activeRepo,
  tasks,
  runs,
  refreshTaskData,
  agentEngine,
}: UseAgentOrchestratorOperationsArgs): UseAgentOrchestratorOperationsResult {
  const [sessionsById, setSessionsById] = useState<SessionStateById>({});
  const mutableStateRef = useRef<OrchestratorMutableState>({
    sessionsById: {},
    tasks,
    runs,
    previousRepo: null,
    repoEpoch: 0,
    inFlightStartsByRepoTask: new Map<string, Promise<string>>(),
    unsubscribersBySession: new Map<string, () => void>(),
    draftRawBySession: {},
    draftSourceBySession: {},
    turnStartedAtBySession: {},
  });
  const refBridges = useMemo<OrchestratorRefBridges>(
    () => ({
      sessionsRef: createMutableBridge(mutableStateRef, "sessionsById"),
      taskRef: createMutableBridge(mutableStateRef, "tasks"),
      runsRef: createMutableBridge(mutableStateRef, "runs"),
      previousRepoRef: createMutableBridge(mutableStateRef, "previousRepo"),
      repoEpochRef: createMutableBridge(mutableStateRef, "repoEpoch"),
      inFlightStartsByRepoTaskRef: createMutableBridge(mutableStateRef, "inFlightStartsByRepoTask"),
      unsubscribersRef: createMutableBridge(mutableStateRef, "unsubscribersBySession"),
      draftRawBySessionRef: createMutableBridge(mutableStateRef, "draftRawBySession"),
      draftSourceBySessionRef: createMutableBridge(mutableStateRef, "draftSourceBySession"),
      turnStartedAtBySessionRef: createMutableBridge(mutableStateRef, "turnStartedAtBySession"),
    }),
    [],
  );

  const commitSessions = useCallback((updater: SessionStateUpdater): void => {
    const current = mutableStateRef.current.sessionsById;
    const next = typeof updater === "function" ? updater(current) : updater;
    mutableStateRef.current.sessionsById = next;
    setSessionsById(next);
  }, []);

  useEffect(() => {
    mutableStateRef.current.tasks = tasks;
    mutableStateRef.current.runs = runs;
  }, [runs, tasks]);

  useEffect(() => {
    if (mutableStateRef.current.previousRepo === activeRepo) {
      return;
    }
    mutableStateRef.current.repoEpoch += 1;
    mutableStateRef.current.previousRepo = activeRepo;

    const unsubs = [...mutableStateRef.current.unsubscribersBySession.values()];
    for (const unsubscribe of unsubs) {
      unsubscribe();
    }
    mutableStateRef.current.unsubscribersBySession.clear();
    mutableStateRef.current.draftRawBySession = {};
    mutableStateRef.current.draftSourceBySession = {};
    mutableStateRef.current.turnStartedAtBySession = {};
    mutableStateRef.current.inFlightStartsByRepoTask.clear();
    commitSessions({});
  }, [activeRepo, commitSessions]);

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
      const currentSessions = mutableStateRef.current.sessionsById;
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
    [activeRepo, commitSessions, persistSessionSnapshot],
  );

  const resolveTurnDurationMs = useCallback(
    (
      sessionId: string,
      timestamp: string,
      messages: AgentChatMessage[] = [],
    ): number | undefined => {
      const parsedTimestamp = Date.parse(timestamp);
      const endedAt = Number.isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp;

      const startedAt = mutableStateRef.current.turnStartedAtBySession[sessionId];
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
    delete mutableStateRef.current.turnStartedAtBySession[sessionId];
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
        repoEpochRef: refBridges.repoEpochRef,
        previousRepoRef: refBridges.previousRepoRef,
        sessionsRef: refBridges.sessionsRef,
        setSessionsById: commitSessions,
        taskRef: refBridges.taskRef,
        updateSession,
        loadSessionTodos,
        loadSessionModelCatalog,
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

  const attachSessionListener = useCallback(
    (repoPath: string, sessionId: string): void => {
      const unsubscribe = attachAgentSessionListener({
        adapter: agentEngine,
        repoPath,
        sessionId,
        sessionsRef: refBridges.sessionsRef,
        draftRawBySessionRef: refBridges.draftRawBySessionRef,
        draftSourceBySessionRef: refBridges.draftSourceBySessionRef,
        turnStartedAtBySessionRef: refBridges.turnStartedAtBySessionRef,
        updateSession,
        resolveTurnDurationMs,
        clearTurnDuration,
        refreshTaskData,
        loadSessionTodos,
      });

      mutableStateRef.current.unsubscribersBySession.set(sessionId, unsubscribe);
    },
    [
      agentEngine,
      clearTurnDuration,
      loadSessionTodos,
      refBridges,
      refreshTaskData,
      resolveTurnDurationMs,
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

  useEffect(() => {
    return () => {
      const unsubs = [...mutableStateRef.current.unsubscribersBySession.values()];
      for (const unsubscribe of unsubs) {
        unsubscribe();
      }
      mutableStateRef.current.unsubscribersBySession.clear();
      mutableStateRef.current.inFlightStartsByRepoTask.clear();
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
