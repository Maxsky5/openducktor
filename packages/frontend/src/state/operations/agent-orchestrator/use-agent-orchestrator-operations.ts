import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { useCallback, useMemo } from "react";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import type {
  ActiveWorkspace,
  AgentOperationsContextValue,
  AgentSessionHistoryLoadContextValue,
  AgentSessionReadModelStateContextValue,
} from "@/types/state-slices";
import type { EnsureSession, UpdateSession } from "./events/session-event-types";
import { createOrchestratorPublicOperations } from "./handlers/public-operations";
import { createAgentSessionActions } from "./handlers/session-actions";
import {
  createLoadAgentSessionHistory,
  createLoadSelectedSessionBaselineHistory,
} from "./history/session-history-loader";
import { useAgentSessionObservers } from "./hooks/use-agent-session-observers";
import { useOrchestratorSessionState } from "./hooks/use-orchestrator-session-state";
import { useRepoSessionReadModel } from "./hooks/use-repo-session-read-model";
import { createEnsureRuntime, loadRepoPromptOverrides, loadTaskDocuments } from "./runtime/runtime";
import { createLoadSourceSession } from "./session-read-model/source-session-loader";
import { runOrchestratorSideEffect } from "./support/async-side-effects";
import { createDefaultAgentOrchestratorDependencies } from "./support/orchestrator-dependency-defaults";
import type { AgentOrchestratorDependencies } from "./support/orchestrator-ports";
import { toPersistedSessionRecord } from "./support/persistence";
import { createSessionCacheEffects } from "./support/session-cache-effects";
import { isWorkflowAgentSession } from "./support/workflow-session";

type UseAgentOrchestratorOperationsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
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

type UseAgentOrchestratorOperationsResult = {
  sessionStore: AgentSessionsStore;
  operations: AgentOperationsContextValue;
  historyLoadActions: AgentSessionHistoryLoadContextValue;
  readModelState: AgentSessionReadModelStateContextValue;
};

export function useAgentOrchestratorOperations({
  activeWorkspace,
  tasks,
  isLoadingTasks,
  refreshTaskData,
  agentEngine,
  dependencies,
}: UseAgentOrchestratorOperationsArgs): UseAgentOrchestratorOperationsResult {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const taskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);
  const resolvedDependencies = useMemo(
    () => dependencies ?? createDefaultAgentOrchestratorDependencies(),
    [dependencies],
  );
  const { queryClient, hostPort, runtimeHostPort } = resolvedDependencies;
  const {
    sessionStore,
    taskRef,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    sessionStartGateRef,
    sessionObserversRef,
    sessionTurnState,
  } = useOrchestratorSessionState({
    workspaceRepoPath,
    tasks,
  });
  const sessionCacheEffects = useMemo(
    () => createSessionCacheEffects({ workspaceRepoPath, queryClient, hostPort }),
    [workspaceRepoPath, queryClient, hostPort],
  );
  const { persistSessionRecord, invalidateSessionStopQueries } = sessionCacheEffects;
  const updateSession = useCallback<UpdateSession>(
    (identity, updater, options) => {
      const shouldPersist = options?.persist === true;
      const nextSession = sessionStore.updateSession(identity, (current) => {
        const next = updater(current);
        if (shouldPersist && !isWorkflowAgentSession(next)) {
          throw new Error(`Session '${identity.externalSessionId}' is not a workflow session.`);
        }
        return next;
      });
      if (!nextSession) {
        return null;
      }

      if (shouldPersist) {
        runOrchestratorSideEffect(
          "operations-persist-session-snapshot",
          persistSessionRecord(nextSession.taskId, toPersistedSessionRecord(nextSession)),
          {
            tags: {
              repoPath: workspaceRepoPath,
              externalSessionId: nextSession.externalSessionId,
              taskId: nextSession.taskId,
              role: nextSession.role,
            },
          },
        );
      }

      return nextSession;
    },
    [persistSessionRecord, sessionStore, workspaceRepoPath],
  );
  const ensureSession = useCallback<EnsureSession>(
    (identity, createSession) => {
      const current = sessionStore.getSessionSnapshot(identity);
      if (current) {
        return current;
      }

      const nextSession = createSession();
      sessionStore.replaceSession(nextSession);
      return nextSession;
    },
    [sessionStore],
  );
  const queryBackedPromptOverrides = useCallback(
    (workspaceId: string) => loadRepoPromptOverrides(workspaceId, { queryClient }),
    [queryClient],
  );
  const { observeAgentSession, clearSessionObservationState } = useAgentSessionObservers({
    agentEngine,
    workspaceId,
    loadRepoPromptOverrides: queryBackedPromptOverrides,
    sessionObserversRef,
    sessionTurnState,
    readSession: sessionStore.getSessionSnapshot,
    ensureSession,
    updateSession,
    queryClient,
    refreshTaskData,
  });
  const loadSourceSession = useMemo(
    () =>
      createLoadSourceSession({
        workspaceRepoPath,
        adapter: agentEngine,
        repoEpochRef,
        currentWorkspaceRepoPathRef,
        commitSessionCollection: sessionStore.commitSessionCollection,
        observeAgentSession,
        queryClient,
      }),
    [
      agentEngine,
      currentWorkspaceRepoPathRef,
      observeAgentSession,
      queryClient,
      repoEpochRef,
      sessionStore,
      workspaceRepoPath,
    ],
  );
  const sessionHistoryLoaders = useMemo(() => {
    const loaderArgs = {
      workspaceRepoPath,
      workspaceId,
      adapter: agentEngine,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
      readSessionSnapshot: sessionStore.getSessionSnapshot,
      updateSession,
      taskRef,
      loadRepoPromptOverrides: queryBackedPromptOverrides,
    };

    return {
      loadAgentSessionHistory: createLoadAgentSessionHistory(loaderArgs),
      loadSelectedSessionBaselineHistory: createLoadSelectedSessionBaselineHistory(loaderArgs),
    };
  }, [
    agentEngine,
    currentWorkspaceRepoPathRef,
    queryBackedPromptOverrides,
    repoEpochRef,
    sessionStore,
    taskRef,
    updateSession,
    workspaceId,
    workspaceRepoPath,
  ]);
  const currentSessionReadModel = useRepoSessionReadModel({
    workspaceRepoPath,
    taskIds,
    isLoadingTasks,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    commitSessionCollection: sessionStore.commitSessionCollection,
    agentEngine,
    observeAgentSession,
    clearSessionObservationState,
    loadLiveSessionHistory: sessionHistoryLoaders.loadSelectedSessionBaselineHistory,
    queryClient,
  });
  const ensureRuntime = useMemo(
    () =>
      createEnsureRuntime({
        refreshTaskData,
        hostClient: {
          ...runtimeHostPort,
          taskWorktreeGet: hostPort.taskWorktreeGet,
        },
      }),
    [refreshTaskData, runtimeHostPort, hostPort.taskWorktreeGet],
  );
  const sessionActions = useMemo(
    () =>
      createAgentSessionActions({
        workspaceRepoPath,
        workspaceId,
        adapter: agentEngine,
        replaceSession: sessionStore.replaceSession,
        removeSession: sessionStore.removeSession,
        readSessionSnapshot: sessionStore.getSessionSnapshot,
        taskRef,
        repoEpochRef,
        currentWorkspaceRepoPathRef,
        sessionStartGateRef,
        sessionObserversRef,
        sessionTurnState,
        updateSession,
        observeAgentSession,
        resolveTaskWorktree: hostPort.taskWorktreeGet,
        ensureRuntime,
        loadTaskDocuments,
        loadRepoPromptOverrides: queryBackedPromptOverrides,
        loadSourceSession,
        loadAgentSessionHistory: sessionHistoryLoaders.loadAgentSessionHistory,
        refreshTaskData,
        persistSessionRecord,
        stopAuthoritativeSession: hostPort.agentSessionStop,
        invalidateSessionStopQueries,
      }),
    [
      agentEngine,
      currentWorkspaceRepoPathRef,
      ensureRuntime,
      hostPort,
      invalidateSessionStopQueries,
      loadSourceSession,
      observeAgentSession,
      persistSessionRecord,
      queryBackedPromptOverrides,
      repoEpochRef,
      refreshTaskData,
      sessionObserversRef,
      sessionStore,
      sessionHistoryLoaders,
      sessionStartGateRef,
      sessionTurnState,
      taskRef,
      updateSession,
      workspaceId,
      workspaceRepoPath,
    ],
  );
  const readModelState = useMemo<AgentSessionReadModelStateContextValue>(
    () => ({
      sessionReadModelLoadState: currentSessionReadModel.sessionReadModelLoadState,
      reloadSessionReadModel: currentSessionReadModel.reloadSessionReadModel,
    }),
    [currentSessionReadModel],
  );
  const operations = useMemo<AgentOperationsContextValue>(
    () =>
      createOrchestratorPublicOperations({
        agentEngine,
        sessionActions,
        loadAgentSessionHistory: sessionHistoryLoaders.loadAgentSessionHistory,
      }),
    [agentEngine, sessionHistoryLoaders, sessionActions],
  );
  const historyLoadActions = useMemo<AgentSessionHistoryLoadContextValue>(
    () => ({
      loadSelectedSessionBaselineHistory: sessionHistoryLoaders.loadSelectedSessionBaselineHistory,
    }),
    [sessionHistoryLoaders],
  );

  return useMemo<UseAgentOrchestratorOperationsResult>(
    () => ({
      sessionStore,
      operations,
      historyLoadActions,
      readModelState,
    }),
    [historyLoadActions, operations, readModelState, sessionStore],
  );
}
