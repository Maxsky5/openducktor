import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { useCallback, useMemo } from "react";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { loadAgentSessionContextFromQuery } from "@/state/queries/agent-session-context";
import { agentSessionHistoryQueryKeys } from "@/state/queries/agent-session-history";
import { updateSessionTodosQueryData } from "@/state/queries/agent-session-todos";
import { refreshAgentSessionListQuery } from "@/state/queries/agent-sessions";
import { taskWorktreeQueryKeys } from "@/state/queries/build-runtime";
import { invalidateRepoTaskQueries } from "@/state/queries/tasks";
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
import { createWorkflowSessionHistoryPromptPolicy } from "./history/workflow-session-history-policy";
import { useOrchestratorSessionState } from "./hooks/use-orchestrator-session-state";
import { useRepoSessionReadModel } from "./hooks/use-repo-session-read-model";
import {
  createEnsureExistingSessionRuntime,
  loadRepoPromptOverrides,
  loadTaskDocuments,
} from "./runtime/runtime";
import { toContextUsage } from "./session-read-model/agent-session-live-projection";
import { createLoadSourceSession } from "./session-read-model/source-session-loader";
import { createDefaultAgentOrchestratorDependencies } from "./support/orchestrator-dependency-defaults";
import type { AgentOrchestratorDependencies } from "./support/orchestrator-ports";

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
  const invalidateSessionStopQueries = useCallback(
    ({ repoPath }: { repoPath: string; taskId: string }) =>
      invalidateRepoTaskQueries(queryClient, repoPath),
    [queryClient],
  );
  const refreshSessionRecords = useCallback(
    (repoPath: string, taskId: string) =>
      refreshAgentSessionListQuery(queryClient, repoPath, taskId, hostPort),
    [hostPort, queryClient],
  );
  const updateSession = useCallback<UpdateSession>(
    (identity, updater) => sessionStore.updateSession(identity, updater),
    [sessionStore],
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
        readPort: hostPort,
      }),
    [
      currentWorkspaceRepoPathRef,
      hostPort,
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
      loadSystemPromptContext: createWorkflowSessionHistoryPromptPolicy({
        workspaceId,
        taskRef,
        loadRepoPromptOverrides: queryBackedPromptOverrides,
      }),
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
        readSessionSnapshot: sessionStore.getSessionSnapshot,
        taskRef,
        repoEpochRef,
        currentWorkspaceRepoPathRef,
        sessionStartGateRef,
        sessionTurnState,
        updateSession,
        canonicalizePath: runtimeHostPort.gitCanonicalizePath,
        startWorkflowSession: async (input) => {
          try {
            return await runtimeHostPort.agentSessionWorkflowStart(input);
          } catch (cause) {
            await queryClient.invalidateQueries({
              queryKey: taskWorktreeQueryKeys.taskWorktree({
                repoPath: input.repoPath,
                taskId: input.sessionScope.taskId,
              }),
            });
            throw cause;
          }
        },
        ensureExistingSessionRuntime,
        loadTaskDocuments: (repoPath, taskId) =>
          loadTaskDocuments(repoPath, taskId, hostPort.taskMetadataGetFresh),
        loadRepoPromptOverrides: queryBackedPromptOverrides,
        loadSettingsSnapshot: () => loadSettingsSnapshotFromQuery(queryClient),
        liveSessionHost: liveSessionHostPort,
        loadSourceSession,
        loadAgentSessionHistory: sessionHistoryLoaders.loadAgentSessionHistory,
        refreshSessionRecords,
        refreshTaskData,
        invalidateSessionStopQueries,
      }),
    [
      agentEngine,
      currentWorkspaceRepoPathRef,
      ensureExistingSessionRuntime,
      hostPort,
      invalidateSessionStopQueries,
      loadSourceSession,
      queryBackedPromptOverrides,
      queryClient,
      repoEpochRef,
      refreshSessionRecords,
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
      getSessionFault: currentSessionReadModel.getSessionFault,
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
          const previousContextUsage = sessionStore.getSessionSnapshot(session)?.contextUsage;
          const contextUsage = await loadAgentSessionContextFromQuery(
            queryClient,
            {
              ...session,
              repoPath: workspaceRepoPath,
            },
            liveSessionHostPort.agentSessionLiveLoadContext,
          );
          if (contextUsage) {
            sessionStore.updateSession(session, (current) => {
              if (current.contextUsage !== previousContextUsage) {
                return current;
              }
              return { ...current, contextUsage: toContextUsage(contextUsage) };
            });
          }
        },
      }),
    [
      agentEngine,
      liveSessionHostPort,
      queryClient,
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
