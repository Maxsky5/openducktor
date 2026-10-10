import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { useCallback, useMemo } from "react";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { loadAgentSessionContextFromQuery } from "@/state/queries/agent-session-context";
import {
  agentSessionHistoryQueryKeys,
  sessionHistoryQueryOptions,
} from "@/state/queries/agent-session-history";
import { updateSessionTodosQueryData } from "@/state/queries/agent-session-todos";
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
import { createLoadAgentSessionHistory } from "./history/session-history-loader";
import { markSessionHistoriesStale } from "./history/session-history-freshness";
import { createSessionHistoryReadGeneration } from "./history/session-history-read-generation";
import { createWorkflowSessionHistoryPromptPolicy } from "./history/workflow-session-history-policy";
import { useOrchestratorSessionState } from "./hooks/use-orchestrator-session-state";
import { useRepoSessionReadModel } from "./hooks/use-repo-session-read-model";
import { loadRepoPromptOverrides } from "./runtime/runtime";
import {
  closeProjectedBackgroundQuestions,
  toContextUsage,
} from "./session-read-model/agent-session-live-projection";
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
  const { queryClient, hostPort, liveSessionHostPort } = resolvedDependencies;
  const { sessionStore, taskRef, currentWorkspaceRepoPathRef, repoEpochRef, sessionTurnState } =
    useOrchestratorSessionState({
      workspaceRepoPath,
      tasks,
    });
  const invalidateSessionStopQueries = useCallback(
    ({ repoPath }: { repoPath: string; taskId: string }) =>
      invalidateRepoTaskQueries(queryClient, repoPath),
    [queryClient],
  );
  const updateSession = useCallback<UpdateSession>(
    (identity, updater) => sessionStore.updateSession(identity, updater),
    [sessionStore],
  );
  const closeBackgroundQuestions = useCallback(
    (
      identity: Parameters<typeof closeProjectedBackgroundQuestions>[1],
      requestIds: readonly string[],
    ) =>
      sessionStore.setSessionCollection((current) =>
        closeProjectedBackgroundQuestions(current, identity, requestIds),
      ),
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
  const historyReadGeneration = useMemo(() => createSessionHistoryReadGeneration(), []);
  const sessionHistoryLoaders = useMemo(() => {
    const loaderArgs = {
      workspaceRepoPath,
      workspaceId,
      adapter: {
        loadSessionHistory: (input: Parameters<AgentEnginePort["loadSessionHistory"]>[0]) =>
          queryClient.fetchQuery(sessionHistoryQueryOptions(input, agentEngine.loadSessionHistory)),
      },
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
      historyReadGeneration,
    };

    return {
      loadAgentSessionHistory: createLoadAgentSessionHistory(loaderArgs),
    };
  }, [
    agentEngine,
    currentWorkspaceRepoPathRef,
    historyReadGeneration,
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
    if (!workspaceRepoPath) return;
    const filters = { queryKey: agentSessionHistoryQueryKeys.workspace(workspaceRepoPath) };
    const cancelledReads = queryClient.cancelQueries(filters);
    sessionStore.setSessionCollection(markSessionHistoriesStale);
    await cancelledReads;
    await queryClient.invalidateQueries({
      ...filters,
      refetchType: "active",
    });
  }, [queryClient, sessionStore, workspaceRepoPath]);
  const currentSessionReadModel = useRepoSessionReadModel({
    workspaceRepoPath,
    workspaceId,
    taskIds,
    isLoadingTasks,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    commitSessionCollection: sessionStore.commitSessionCollection,
    applyLiveNotices: sessionStore.applyLiveNotices,
    liveSessionPort: liveSessionHostPort,
    transcriptEvents,
    recoverTranscriptGap,
    queryClient,
    sessionReadPort: hostPort,
  });
  const sessionActions = useMemo(
    () =>
      createAgentSessionActions({
        workspaceRepoPath,
        workspaceId,
        adapter: agentEngine,
        readSessionSnapshot: sessionStore.getSessionSnapshot,
        taskRef,
        repoEpochRef,
        currentWorkspaceRepoPathRef,
        sessionTurnState,
        updateSession,
        closeBackgroundQuestions,
        loadRepoPromptOverrides: queryBackedPromptOverrides,
        liveSessionHost: liveSessionHostPort,
        refreshTaskData,
        invalidateSessionStopQueries,
      }),
    [
      agentEngine,
      currentWorkspaceRepoPathRef,
      closeBackgroundQuestions,
      invalidateSessionStopQueries,
      queryBackedPromptOverrides,
      repoEpochRef,
      refreshTaskData,
      liveSessionHostPort,
      sessionStore,
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
      workspaceSessionRecordsError: currentSessionReadModel.workspaceSessionRecordsError,
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
      loadAgentSessionHistory: sessionHistoryLoaders.loadAgentSessionHistory,
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
