import type { AgentSessionRecord, RuntimeKind, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { useCallback, useMemo } from "react";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import type { AgentSessionHistoryPreludeMode, AgentSessionState } from "@/types/agent-orchestrator";
import type {
  ActiveWorkspace,
  AgentOperationsContextValue,
  AgentStateContextValue,
} from "@/types/state-slices";
import { createOrchestratorPublicOperations } from "./handlers/public-operations";
import { createAgentSessionActions } from "./handlers/session-actions";
import { useAgentSessionHydration } from "./hooks/use-agent-session-hydration";
import { useAgentSessionListeners } from "./hooks/use-agent-session-listeners";
import { useAgentSessionMutations } from "./hooks/use-agent-session-mutations";
import { useAgentSessionReaders } from "./hooks/use-agent-session-readers";
import { useAgentSessionTurnTiming } from "./hooks/use-agent-session-turn-timing";
import { useOrchestratorSessionState } from "./hooks/use-orchestrator-session-state";
import { useRepoSessionHydrationEffects } from "./hooks/use-repo-session-hydration-effects";
import { useRuntimeTranscriptAttachment } from "./hooks/use-runtime-transcript-attachment";
import { createLoadAgentSessions } from "./lifecycle/load-sessions";
import { prepareRepoSessionPresencePreloads } from "./lifecycle/repo-session-presence-preloads";
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
  isSessionRuntimeReady: (runtimeKind: RuntimeKind) => boolean;
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
  retrySessionRuntimeAttachment: (input: {
    taskId: string;
    externalSessionId: string;
    recoveryDedupKey?: string | null;
    historyPreludeMode?: AgentSessionHistoryPreludeMode;
    allowLiveSessionResume?: boolean;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<boolean>;
  sessionStore: AgentSessionsStore;
  operations: AgentOperationsContextValue;
};

export function useAgentOrchestratorOperations({
  activeWorkspace,
  tasks,
  refreshTaskData,
  agentEngine,
  isSessionRuntimeReady,
  dependencies,
}: UseAgentOrchestratorOperationsArgs): UseAgentOrchestratorOperationsResult {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const resolvedDependencies = useMemo(
    () => dependencies ?? createDefaultAgentOrchestratorDependencies(),
    [dependencies],
  );
  const { queryClient, hostPort, runtimeHostPort } = resolvedDependencies;
  const { sessionStore, refBridges, commitSessions } = useOrchestratorSessionState({
    activeWorkspace,
    tasks,
  });
  const { sessionsRef, unsubscribersRef } = refBridges;
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
  const { attachSessionListener, removeAgentSession, removeAgentSessions, removeSessionIds } =
    useAgentSessionListeners({
      agentEngine,
      refBridges,
      sessionsRef,
      commitSessions,
      updateSession,
      ...turnTiming,
      refreshTaskData,
    });
  const attachRuntimeTranscriptSession = useRuntimeTranscriptAttachment({
    agentEngine,
    sessionsRef,
    unsubscribersRef,
    commitSessions,
    updateSession,
    attachSessionListener,
    removeSessionIds,
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
        activeWorkspaceRef: refBridges.activeWorkspaceRef,
        currentWorkspaceRepoPathRef: refBridges.currentWorkspaceRepoPathRef,
        sessionsRef: refBridges.sessionsRef,
        setSessionsById: commitSessions,
        taskRef: refBridges.taskRef,
        updateSession,
        attachSessionListener,
        loadRepoPromptOverrides: queryBackedPromptOverrides,
        loadTaskDocuments,
        queryClient,
      }),
    [
      activeWorkspace,
      agentEngine,
      attachSessionListener,
      commitSessions,
      queryBackedPromptOverrides,
      queryClient,
      refBridges,
      updateSession,
    ],
  );
  const { sessionHydration, retrySessionRuntimeAttachment, ensureSessionReadyForView } =
    useAgentSessionHydration({
      loadAgentSessions,
      sessionsRef,
      updateSession,
    });
  const prepareSessionPresencePreloads = useCallback(
    ({ repoPath, records }: { repoPath: string; records: AgentSessionRecord[] }) =>
      prepareRepoSessionPresencePreloads({
        repoPath,
        records,
        listSessionPresence: (input) => agentEngine.listSessionPresence(input),
      }),
    [agentEngine],
  );
  useRepoSessionHydrationEffects({
    workspaceRepoPath,
    tasks,
    currentWorkspaceRepoPathRef: refBridges.currentWorkspaceRepoPathRef,
    sessionHydration,
    prepareRepoSessionPresencePreloads: prepareSessionPresencePreloads,
    isSessionRuntimeReady,
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
        activeWorkspaceRef: refBridges.activeWorkspaceRef,
        currentWorkspaceRepoPathRef: refBridges.currentWorkspaceRepoPathRef,
        inFlightStartsByWorkspaceTaskRef: refBridges.inFlightStartsByWorkspaceTaskRef,
        unsubscribersRef: refBridges.unsubscribersRef,
        turnStartedAtBySessionRef: refBridges.turnStartedAtBySessionRef,
        turnUserAnchorAtBySessionRef: refBridges.turnUserAnchorAtBySessionRef,
        turnModelBySessionRef: refBridges.turnModelBySessionRef,
        updateSession,
        attachSessionListener,
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
      attachSessionListener,
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
    const operations = createOrchestratorPublicOperations({
      bootstrapTaskSessions: sessionHydration.bootstrapTaskSessions,
      hydrateRequestedTaskSessionHistory: sessionHydration.hydrateRequestedTaskSession,
      ensureSessionReadyForView,
      reconcileLiveTaskSessions: sessionHydration.reconcileLiveTaskSessions,
      loadAgentSessions,
      ...readers,
      attachRuntimeTranscriptSession,
      removeAgentSession,
      removeAgentSessions,
      sessionActions,
    });

    return {
      get sessions() {
        return sessionStore.getSessionsSnapshot();
      },
      ...operations,
      commitSessions,
      retrySessionRuntimeAttachment,
      sessionStore,
      operations,
    };
  }, [
    sessionStore,
    sessionHydration,
    commitSessions,
    loadAgentSessions,
    readers,
    attachRuntimeTranscriptSession,
    retrySessionRuntimeAttachment,
    ensureSessionReadyForView,
    removeAgentSessions,
    removeAgentSession,
    sessionActions,
  ]);
}
