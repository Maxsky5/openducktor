import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type {
  ActiveWorkspace,
  AgentOperationsContextValue,
  AgentSessionReadModelStateContextValue,
  AgentStateContextValue,
} from "@/types/state-slices";
import { createOrchestratorPublicOperations } from "./handlers/public-operations";
import { createAgentSessionActions } from "./handlers/session-actions";
import { useAgentSessionHistory } from "./hooks/use-agent-session-history";
import { useAgentSessionListeners } from "./hooks/use-agent-session-listeners";
import { useAgentSessionMutations } from "./hooks/use-agent-session-mutations";
import { useAgentSessionReaders } from "./hooks/use-agent-session-readers";
import { useAgentSessionTurnTiming } from "./hooks/use-agent-session-turn-timing";
import { useOrchestratorSessionState } from "./hooks/use-orchestrator-session-state";
import { useRepoSessionReadModelEffects } from "./hooks/use-repo-session-read-model-effects";
import { createLoadAgentSessionHistory, createLoadAgentSessions } from "./lifecycle/load-sessions";
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
   * an inline object recreates downstream session hydration callbacks on every render.
   */
  dependencies?: AgentOrchestratorDependencies;
};

type UseAgentOrchestratorOperationsResult = AgentStateContextValue & {
  commitSessions: (
    updater:
      | Record<string, AgentSessionState>
      | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
  ) => void;
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
  const { listenToAgentSession, removeAgentSession, removeAgentSessions } =
    useAgentSessionListeners({
      agentEngine,
      refBridges,
      sessionsRef,
      commitSessions,
      updateSession,
      ...turnTiming,
      refreshTaskData,
    });
  const queryBackedPromptOverrides = useCallback(
    (workspaceId: string) => loadRepoPromptOverrides(workspaceId, { queryClient }),
    [queryClient],
  );
  const loadAgentSessions = useMemo(
    () =>
      createLoadAgentSessions({
        activeWorkspace,
        adapter: agentEngine,
        repoEpochRef: refBridges.repoEpochRef,
        currentWorkspaceRepoPathRef: refBridges.currentWorkspaceRepoPathRef,
        setSessionsById: commitSessions,
        updateSession,
        listenToAgentSession,
        queryClient,
      }),
    [
      activeWorkspace,
      agentEngine,
      listenToAgentSession,
      commitSessions,
      queryClient,
      refBridges,
      updateSession,
    ],
  );
  const loadAgentSessionHistory = useMemo(
    () =>
      createLoadAgentSessionHistory({
        activeWorkspace,
        adapter: agentEngine,
        repoEpochRef: refBridges.repoEpochRef,
        currentWorkspaceRepoPathRef: refBridges.currentWorkspaceRepoPathRef,
        updateSession,
        queryClient,
      }),
    [activeWorkspace, agentEngine, queryClient, refBridges, updateSession],
  );
  const { loadRequestedTaskSessionHistory, ensureSessionReadyForView } = useAgentSessionHistory({
    loadAgentSessionHistory,
    sessionsRef,
  });
  useRepoSessionReadModelEffects({
    workspaceRepoPath,
    tasks,
    currentWorkspaceRepoPathRef: refBridges.currentWorkspaceRepoPathRef,
    commitSessions,
    updateSession,
    agentEngine,
    listenToAgentSession,
    setSessionReadModelError,
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
        setSessionsById: commitSessions,
        sessionsRef: refBridges.sessionsRef,
        taskRef: refBridges.taskRef,
        repoEpochRef: refBridges.repoEpochRef,
        currentWorkspaceRepoPathRef: refBridges.currentWorkspaceRepoPathRef,
        inFlightStartsByWorkspaceTaskRef: refBridges.inFlightStartsByWorkspaceTaskRef,
        unsubscribersRef: refBridges.unsubscribersRef,
        turnStartedAtBySessionRef: refBridges.turnStartedAtBySessionRef,
        turnUserAnchorAtBySessionRef: refBridges.turnUserAnchorAtBySessionRef,
        turnModelBySessionRef: refBridges.turnModelBySessionRef,
        updateSession,
        listenToAgentSession,
        resolveTaskWorktree: hostPort.taskWorktreeGet,
        ensureRuntime,
        loadTaskDocuments,
        loadRepoPromptOverrides: queryBackedPromptOverrides,
        loadAgentSessions,
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
      loadAgentSessions,
      persistSessionRecord,
      queryBackedPromptOverrides,
      refBridges,
      refreshTaskData,
      turnTiming.clearTurnDuration,
      updateSession,
    ],
  );
  const readers = useAgentSessionReaders(agentEngine);

  return useMemo<UseAgentOrchestratorOperationsResult>(() => {
    const readModelState = { sessionReadModelError };
    const operations = createOrchestratorPublicOperations({
      loadRequestedTaskSessionHistory: loadRequestedTaskSessionHistory,
      ensureSessionReadyForView,
      loadAgentSessions,
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
    sessionReadModelError,
    sessionStore,
    loadRequestedTaskSessionHistory,
    commitSessions,
    loadAgentSessions,
    readers,
    ensureSessionReadyForView,
    removeAgentSessions,
    removeAgentSession,
    sessionActions,
  ]);
}
