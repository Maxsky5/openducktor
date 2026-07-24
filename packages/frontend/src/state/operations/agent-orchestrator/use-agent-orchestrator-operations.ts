import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { useCallback, useMemo } from "react";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { agentSessionHistoryQueryKeys } from "@/state/queries/agent-session-history";
import { updateSessionTodosQueryData } from "@/state/queries/agent-session-todos";
import { loadSettingsSnapshotFromQuery } from "@/state/queries/workspace";
import type {
  ActiveWorkspace,
  AgentOperationsContextValue,
  AgentSessionHistoryLoadContextValue,
  AgentSessionReadModelStateContextValue,
} from "@/types/state-slices";
import type { EnsureSession, UpdateSession } from "./events/session-event-types";
import { createAgentSessionTranscriptEventConsumer } from "./events/session-transcript-events";
import { createOrchestratorPublicOperations } from "./handlers/public-operations";
import { createAgentSessionActions } from "./handlers/session-actions";
import {
  createLoadAgentSessionHistory,
  createLoadSelectedSessionBaselineHistory,
  createReloadAgentSessionHistory,
} from "./history/session-history-loader";
import { useOrchestratorSessionState } from "./hooks/use-orchestrator-session-state";
import { useRepoSessionReadModel } from "./hooks/use-repo-session-read-model";
import {
  createEnsureExistingSessionRuntime,
  createEnsureRuntime,
  loadRepoPromptOverrides,
  loadTaskDocuments,
} from "./runtime/runtime";
import { toContextUsage } from "./session-read-model/agent-session-live-projection";
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
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
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
  const { queryClient, hostPort, runtimeHostPort, liveSessionHostPort } = resolvedDependencies;
  const {
    sessionStore,
    taskRef,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    sessionStartGateRef,
    sessionTurnState,
  } = useOrchestratorSessionState({
    workspaceRepoPath,
    tasks,
  });
  const sessionCacheEffects = useMemo(
    () => createSessionCacheEffects({ workspaceRepoPath, queryClient, hostPort }),
    [workspaceRepoPath, queryClient, hostPort],
  );
  const { deleteSessionRecord, persistSessionRecord, invalidateSessionStopQueries } =
    sessionCacheEffects;
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
  const transcriptEvents = useMemo(
    () =>
      createAgentSessionTranscriptEventConsumer({
        readSession: sessionStore.getSessionSnapshot,
        ensureSession,
        updateSession,
        updateSessionTodos: (session, updater) =>
          updateSessionTodosQueryData(queryClient, session, updater),
        sessionTurnState,
      }),
    [ensureSession, queryClient, sessionStore, sessionTurnState, updateSession],
  );
  const loadSourceSession = useMemo(
    () =>
      createLoadSourceSession({
        workspaceRepoPath,
        repoEpochRef,
        currentWorkspaceRepoPathRef,
        readSessionSnapshot: sessionStore.getSessionSnapshot,
        queryClient,
      }),
    [currentWorkspaceRepoPathRef, queryClient, repoEpochRef, sessionStore, workspaceRepoPath],
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
      loadSettingsSnapshot: () => loadSettingsSnapshotFromQuery(queryClient),
    };

    return {
      loadAgentSessionHistory: createLoadAgentSessionHistory(loaderArgs),
      loadSelectedSessionBaselineHistory: createLoadSelectedSessionBaselineHistory(loaderArgs),
      reloadAgentSessionHistory: createReloadAgentSessionHistory(loaderArgs),
    };
  }, [
    agentEngine,
    currentWorkspaceRepoPathRef,
    queryBackedPromptOverrides,
    queryClient,
    repoEpochRef,
    sessionStore,
    taskRef,
    updateSession,
    workspaceId,
    workspaceRepoPath,
  ]);
  const recoverTranscriptGap = useCallback(async (): Promise<void> => {
    const loadedSessions = sessionStore
      .listSessionSnapshots()
      .filter((session) => session.historyLoadState === "loaded");

    await Promise.all([
      ...loadedSessions.map((session) =>
        sessionHistoryLoaders.reloadAgentSessionHistory({
          externalSessionId: session.externalSessionId,
          runtimeKind: session.runtimeKind,
          workingDirectory: session.workingDirectory,
        }),
      ),
      queryClient.invalidateQueries({
        queryKey: agentSessionHistoryQueryKeys.all,
        refetchType: "active",
      }),
    ]);
  }, [queryClient, sessionHistoryLoaders, sessionStore]);
  const currentSessionReadModel = useRepoSessionReadModel({
    workspaceRepoPath,
    taskIds,
    isLoadingTasks,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    commitSessionCollection: sessionStore.commitSessionCollection,
    liveSessionPort: liveSessionHostPort,
    transcriptEvents,
    recoverTranscriptGap,
    queryClient,
    sessionReadPort: hostPort,
  });
  const ensureRuntime = useMemo(
    () =>
      createEnsureRuntime({
        refreshTaskData,
        queryClient,
        hostClient: {
          ...runtimeHostPort,
        },
      }),
    [queryClient, refreshTaskData, runtimeHostPort],
  );
  const ensureExistingSessionRuntime = useMemo(
    () => createEnsureExistingSessionRuntime(runtimeHostPort),
    [runtimeHostPort],
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
        sessionTurnState,
        updateSession,
        canonicalizePath: runtimeHostPort.gitCanonicalizePath,
        prepareTaskSessionStartupLease: runtimeHostPort.taskSessionStartupLeasePrepare,
        completeTaskSessionStartupLease: runtimeHostPort.taskSessionStartupLeaseComplete,
        abortTaskSessionStartupLease: runtimeHostPort.taskSessionStartupLeaseAbort,
        resolveTaskWorktree: hostPort.taskWorktreeGet,
        ensureRuntime,
        ensureExistingSessionRuntime,
        loadTaskDocuments: (repoPath, taskId) =>
          loadTaskDocuments(repoPath, taskId, hostPort.taskMetadataGetFresh),
        loadRepoPromptOverrides: queryBackedPromptOverrides,
        loadSettingsSnapshot: () => loadSettingsSnapshotFromQuery(queryClient),
        liveSessionHost: liveSessionHostPort,
        loadSourceSession,
        loadAgentSessionHistory: sessionHistoryLoaders.loadAgentSessionHistory,
        refreshTaskData,
        persistSessionRecord,
        deleteSessionRecord,
        invalidateSessionStopQueries,
      }),
    [
      agentEngine,
      currentWorkspaceRepoPathRef,
      ensureRuntime,
      ensureExistingSessionRuntime,
      hostPort,
      invalidateSessionStopQueries,
      loadSourceSession,
      persistSessionRecord,
      deleteSessionRecord,
      queryBackedPromptOverrides,
      queryClient,
      repoEpochRef,
      refreshTaskData,
      runtimeHostPort,
      liveSessionHostPort,
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
        loadAgentSessionContext: async (session) => {
          if (!workspaceRepoPath) {
            throw new Error("Cannot load agent session context without an active workspace.");
          }
          const contextUsage = await liveSessionHostPort.agentSessionLiveLoadContext({
            repoPath: workspaceRepoPath,
            ...session,
          });
          if (contextUsage) {
            sessionStore.updateSession(session, (current) => ({
              ...current,
              contextUsage: toContextUsage(contextUsage),
            }));
          }
        },
      }),
    [
      agentEngine,
      liveSessionHostPort,
      sessionHistoryLoaders,
      sessionActions,
      sessionStore,
      workspaceRepoPath,
    ],
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
