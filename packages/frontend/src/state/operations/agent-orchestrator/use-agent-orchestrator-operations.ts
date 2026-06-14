import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import type { AgentSessionCollectionUpdater } from "@/state/agent-session-collection";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import type {
  ActiveWorkspace,
  AgentOperationsContextValue,
  AgentSessionReadModelStateContextValue,
  AgentStateContextValue,
} from "@/types/state-slices";
import { createOrchestratorPublicOperations } from "./handlers/public-operations";
import { createAgentSessionActions } from "./handlers/session-actions";
import { useAgentSessionListeners } from "./hooks/use-agent-session-listeners";
import { useAgentSessionMutations } from "./hooks/use-agent-session-mutations";
import { useAgentSessionReaders } from "./hooks/use-agent-session-readers";
import { useAgentSessionTurnTiming } from "./hooks/use-agent-session-turn-timing";
import { useOrchestratorSessionState } from "./hooks/use-orchestrator-session-state";
import { useRepoSessionReadModelEffects } from "./hooks/use-repo-session-read-model-effects";
import { createLoadAgentSessions } from "./lifecycle/load-sessions";
import { createLoadAgentSessionHistory } from "./lifecycle/session-history-loader";
import { createEnsureRuntime, loadRepoPromptOverrides, loadTaskDocuments } from "./runtime/runtime";
import { createDefaultAgentOrchestratorDependencies } from "./support/orchestrator-dependency-defaults";
import type { AgentOrchestratorDependencies } from "./support/orchestrator-ports";
import { createSessionCacheEffects } from "./support/session-cache-effects";

type UseAgentOrchestratorOperationsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  tasks: TaskCard[];
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: { forceFreshTaskList?: boolean },
  ) => Promise<void>;
  agentEngine: AgentEnginePort;
  /**
   * Optional dependency seam for tests and specialized callers.
   * Pass a stable reference, such as a module-level object or a `useMemo` result;
   * an inline object recreates downstream session loading callbacks on every render.
   */
  dependencies?: AgentOrchestratorDependencies;
};

type UseAgentOrchestratorOperationsResult = AgentStateContextValue & {
  commitSessions: (updater: AgentSessionCollectionUpdater) => void;
  sessionStore: AgentSessionsStore;
  operations: AgentOperationsContextValue;
  readModelState: AgentSessionReadModelStateContextValue;
};

export function useAgentOrchestratorOperations({
  activeWorkspace,
  tasks,
  refreshTaskData,
  agentEngine,
  dependencies,
}: UseAgentOrchestratorOperationsArgs): UseAgentOrchestratorOperationsResult {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const [isLoadingSessionReadModel, setIsLoadingSessionReadModel] = useState(false);
  const [sessionReadModelError, setSessionReadModelError] = useState<string | null>(null);
  const resolvedDependencies = useMemo(
    () => dependencies ?? createDefaultAgentOrchestratorDependencies(),
    [dependencies],
  );
  const { queryClient, hostPort, runtimeHostPort } = resolvedDependencies;
  const { sessionStore, refBridges, commitSessions } = useOrchestratorSessionState({
    activeWorkspace,
    tasks,
  });
  const { sessionsRef } = refBridges;
  const sessionCacheEffects = useMemo(
    () => createSessionCacheEffects({ workspaceRepoPath, queryClient, hostPort }),
    [workspaceRepoPath, queryClient, hostPort],
  );
  const { persistSessionRecord, invalidateSessionStopQueries } = sessionCacheEffects;
  const turnTiming = useAgentSessionTurnTiming({
    assistantTurnTimingBySessionRef: refBridges.assistantTurnTimingBySessionRef,
  });
  const { updateSession } = useAgentSessionMutations({
    workspaceRepoPath,
    sessionsRef,
    commitSessions,
    persistSessionRecord,
  });
  const queryBackedPromptOverrides = useCallback(
    (workspaceId: string) => loadRepoPromptOverrides(workspaceId, { queryClient }),
    [queryClient],
  );
  const { listenToAgentSession, removeAgentSession, removeAgentSessions } =
    useAgentSessionListeners({
      agentEngine,
      workspaceId: activeWorkspace?.workspaceId ?? null,
      loadRepoPromptOverrides: queryBackedPromptOverrides,
      refBridges,
      sessionsRef,
      commitSessions,
      updateSession,
      queryClient,
      ...turnTiming,
      refreshTaskData,
    });
  const loadAgentSessions = useMemo(
    () =>
      createLoadAgentSessions({
        activeWorkspace,
        adapter: agentEngine,
        repoEpochRef: refBridges.repoEpochRef,
        currentWorkspaceRepoPathRef: refBridges.currentWorkspaceRepoPathRef,
        setSessionCollection: commitSessions,
        listenToAgentSession,
        queryClient,
      }),
    [activeWorkspace, agentEngine, listenToAgentSession, commitSessions, queryClient, refBridges],
  );
  const loadAgentSessionHistory = useMemo(
    () =>
      createLoadAgentSessionHistory({
        activeWorkspace,
        adapter: agentEngine,
        repoEpochRef: refBridges.repoEpochRef,
        currentWorkspaceRepoPathRef: refBridges.currentWorkspaceRepoPathRef,
        sessionsRef,
        updateSession,
        taskRef: refBridges.taskRef,
        loadRepoPromptOverrides: queryBackedPromptOverrides,
      }),
    [
      activeWorkspace,
      agentEngine,
      queryBackedPromptOverrides,
      refBridges,
      sessionsRef,
      updateSession,
    ],
  );
  useRepoSessionReadModelEffects({
    activeWorkspace,
    tasks,
    currentWorkspaceRepoPathRef: refBridges.currentWorkspaceRepoPathRef,
    repoEpochRef: refBridges.repoEpochRef,
    commitSessions,
    agentEngine,
    listenToAgentSession,
    setIsLoadingSessionReadModel,
    setSessionReadModelError,
    queryClient,
  });
  const ensureRuntime = useMemo(
    () =>
      createEnsureRuntime({
        refreshTaskData,
        queryClient,
        hostClient: {
          ...runtimeHostPort,
          taskWorktreeGet: hostPort.taskWorktreeGet,
        },
      }),
    [refreshTaskData, queryClient, runtimeHostPort, hostPort.taskWorktreeGet],
  );
  const sessionActions = useMemo(
    () =>
      createAgentSessionActions({
        activeWorkspace,
        adapter: agentEngine,
        setSessionCollection: commitSessions,
        sessionsRef: refBridges.sessionsRef,
        taskRef: refBridges.taskRef,
        repoEpochRef: refBridges.repoEpochRef,
        currentWorkspaceRepoPathRef: refBridges.currentWorkspaceRepoPathRef,
        inFlightStartsByWorkspaceTaskRef: refBridges.inFlightStartsByWorkspaceTaskRef,
        sessionListenerRegistryRef: refBridges.sessionListenerRegistryRef,
        turnModelBySessionRef: refBridges.turnModelBySessionRef,
        recordTurnUserMessageTimestamp: turnTiming.recordTurnUserMessageTimestamp,
        readTurnUserMessageStartedAtMs: turnTiming.readTurnUserMessageStartedAtMs,
        updateSession,
        listenToAgentSession,
        resolveTaskWorktree: hostPort.taskWorktreeGet,
        ensureRuntime,
        loadTaskDocuments,
        loadRepoPromptOverrides: queryBackedPromptOverrides,
        loadAgentSessions,
        loadAgentSessionHistory,
        clearTurnDuration: turnTiming.clearTurnDuration,
        refreshTaskData,
        persistSessionRecord,
        stopAuthoritativeSession: hostPort.agentSessionStop,
        invalidateSessionStopQueries,
      }),
    [
      activeWorkspace,
      agentEngine,
      listenToAgentSession,
      commitSessions,
      ensureRuntime,
      hostPort,
      invalidateSessionStopQueries,
      loadAgentSessionHistory,
      loadAgentSessions,
      persistSessionRecord,
      queryBackedPromptOverrides,
      refBridges,
      refreshTaskData,
      turnTiming.clearTurnDuration,
      turnTiming.recordTurnUserMessageTimestamp,
      turnTiming.readTurnUserMessageStartedAtMs,
      updateSession,
    ],
  );
  const readers = useAgentSessionReaders(agentEngine);

  return useMemo<UseAgentOrchestratorOperationsResult>(() => {
    const readModelState = { isLoadingSessionReadModel, sessionReadModelError };
    const operations = createOrchestratorPublicOperations({
      loadAgentSessions,
      loadAgentSessionHistory: async (session) => {
        await loadAgentSessionHistory(session);
      },
      ...readers,
      removeAgentSession,
      removeAgentSessions,
      sessionActions,
    });

    return {
      get sessions() {
        return sessionStore.getSessionsSnapshot();
      },
      ...readModelState,
      ...operations,
      commitSessions,
      sessionStore,
      operations,
      readModelState,
    };
  }, [
    isLoadingSessionReadModel,
    sessionReadModelError,
    sessionStore,
    commitSessions,
    loadAgentSessions,
    loadAgentSessionHistory,
    readers,
    removeAgentSessions,
    removeAgentSession,
    sessionActions,
  ]);
}
