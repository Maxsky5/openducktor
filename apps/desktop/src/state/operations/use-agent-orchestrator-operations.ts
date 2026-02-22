import { errorMessage } from "@/lib/errors";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import { OpencodeSdkAdapter } from "@openducktor/adapters-opencode-sdk";
import type { RunSummary, TaskCard } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentScenario } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
  toPersistedSessionRecord,
  upsertMessage,
} from "./agent-orchestrator";
import { host } from "./host";

type UseAgentOrchestratorOperationsArgs = {
  activeRepo: string | null;
  tasks: TaskCard[];
  runs: RunSummary[];
  refreshTaskData: (repoPath: string) => Promise<void>;
};

type UseAgentOrchestratorOperationsResult = {
  sessions: AgentSessionState[];
  loadAgentSessions: (taskId: string) => Promise<void>;
  startAgentSession: (input: {
    taskId: string;
    role: AgentRole;
    scenario?: AgentScenario;
    sendKickoff?: boolean;
    startMode?: "reuse_latest" | "fresh";
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
}: UseAgentOrchestratorOperationsArgs): UseAgentOrchestratorOperationsResult {
  const [sessionsById, setSessionsById] = useState<Record<string, AgentSessionState>>({});
  const sessionsRef = useRef<Record<string, AgentSessionState>>({});
  const taskRef = useRef<TaskCard[]>(tasks);
  const runsRef = useRef(runs);
  const previousRepoRef = useRef<string | null>(null);
  const repoEpochRef = useRef(0);
  const inFlightStartsByRepoTaskRef = useRef<Map<string, Promise<string>>>(new Map());
  const unsubscribersRef = useRef<Map<string, () => void>>(new Map());
  const draftRawBySessionRef = useRef<Record<string, string>>({});
  const draftSourceBySessionRef = useRef<Record<string, "delta" | "part">>({});
  const turnStartedAtBySessionRef = useRef<Record<string, number>>({});

  useEffect(() => {
    sessionsRef.current = sessionsById;
  }, [sessionsById]);

  useEffect(() => {
    taskRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  useEffect(() => {
    if (previousRepoRef.current === activeRepo) {
      return;
    }
    repoEpochRef.current += 1;
    previousRepoRef.current = activeRepo;

    const unsubs = [...unsubscribersRef.current.values()];
    for (const unsubscribe of unsubs) {
      unsubscribe();
    }
    unsubscribersRef.current.clear();
    draftRawBySessionRef.current = {};
    draftSourceBySessionRef.current = {};
    turnStartedAtBySessionRef.current = {};
    inFlightStartsByRepoTaskRef.current.clear();
    sessionsRef.current = {};
    setSessionsById({});
  }, [activeRepo]);

  const adapter = useMemo(() => new OpencodeSdkAdapter(), []);

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
      const currentSessions = sessionsRef.current;
      const current = currentSessions[sessionId];
      if (!current) {
        return;
      }
      const nextSession = updater(current);
      const nextSessions = {
        ...currentSessions,
        [sessionId]: nextSession,
      };
      sessionsRef.current = nextSessions;
      setSessionsById(nextSessions);

      if (options?.persist !== false) {
        void persistSessionSnapshot(nextSession).catch(() => undefined);
      }
    },
    [persistSessionSnapshot],
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
    [],
  );

  const clearTurnDuration = useCallback((sessionId: string): void => {
    delete turnStartedAtBySessionRef.current[sessionId];
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
        const catalog = await adapter.listAvailableModels({
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
    [adapter, updateSession],
  );

  const loadSessionTodos = useCallback(
    async (
      sessionId: string,
      baseUrl: string,
      workingDirectory: string,
      externalSessionId: string,
    ): Promise<void> => {
      const todos = await adapter.loadSessionTodos({
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
    [adapter, updateSession],
  );

  const loadAgentSessions = useMemo(
    () =>
      createLoadAgentSessions({
        activeRepo,
        adapter,
        repoEpochRef,
        previousRepoRef,
        sessionsRef,
        setSessionsById,
        taskRef,
        updateSession,
        loadSessionTodos,
        loadSessionModelCatalog,
      }),
    [activeRepo, adapter, loadSessionModelCatalog, loadSessionTodos, updateSession],
  );

  const attachSessionListener = useCallback(
    (repoPath: string, sessionId: string): void => {
      const unsubscribe = attachAgentSessionListener({
        adapter,
        repoPath,
        sessionId,
        sessionsRef,
        draftRawBySessionRef,
        draftSourceBySessionRef,
        turnStartedAtBySessionRef,
        updateSession,
        resolveTurnDurationMs,
        clearTurnDuration,
        refreshTaskData,
        loadSessionTodos,
      });

      unsubscribersRef.current.set(sessionId, unsubscribe);
    },
    [
      adapter,
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
        runsRef,
        refreshTaskData,
      }),
    [refreshTaskData],
  );

  const sessionActions = useMemo(
    () =>
      createAgentSessionActions({
        activeRepo,
        adapter,
        setSessionsById,
        sessionsRef,
        taskRef,
        repoEpochRef,
        previousRepoRef,
        inFlightStartsByRepoTaskRef,
        unsubscribersRef,
        turnStartedAtBySessionRef,
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
      adapter,
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
      const unsubs = [...unsubscribersRef.current.values()];
      for (const unsubscribe of unsubs) {
        unsubscribe();
      }
      unsubscribersRef.current.clear();
      inFlightStartsByRepoTaskRef.current.clear();
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
    loadAgentSessions: async (taskId) => {
      try {
        await loadAgentSessions(taskId);
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
    sendAgentMessage: sessionActions.sendAgentMessage,
    stopAgentSession: sessionActions.stopAgentSession,
    updateAgentSessionModel: sessionActions.updateAgentSessionModel,
    replyAgentPermission: sessionActions.replyAgentPermission,
    answerAgentQuestion: sessionActions.answerAgentQuestion,
  };
}
