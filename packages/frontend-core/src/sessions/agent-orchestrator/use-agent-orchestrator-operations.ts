import type { AgentEnginePort } from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import {
  type AgentMessageQueuesStore,
  createAgentMessageQueuesStore,
} from "../agent-message-queues-store";
import type { AgentSessionsStore } from "../agent-sessions-store";
import { loadAgentSessionContextFromQuery } from "../../queries/agent-session-context";
import { sessionHistoryQueryOptions } from "../../queries/agent-session-history";
import { getSessionHistoryFreshnessTracker } from "../../queries/agent-session-history-freshness-tracker";
import { updateSessionTodosQueryData } from "../../queries/agent-session-todos";
import { invalidateRepoTaskQueries } from "../../queries/tasks";
import { loadSettingsSnapshotFromQuery } from "../../queries/workspace";
import type {
  ActiveWorkspace,
  AgentOperationsContextValue,
  AgentSessionHistoryLoadContextValue,
  AgentSessionReadModelStateContextValue,
} from "../../types/session-slices";
import type { EnsureSession, UpdateSession } from "./events/session-event-types";
import { createAgentSessionTranscriptEventConsumer } from "./events/session-transcript-events";
import { createOrchestratorPublicOperations } from "./handlers/public-operations";
import { createAgentSessionActions } from "./handlers/session-actions";
import { createLoadAgentSessionHistory } from "./history/session-history-loader";
import { createSessionHistoryReadGeneration } from "./history/session-history-read-generation";
import { createWorkflowSessionHistoryPromptPolicy } from "./history/workflow-session-history-policy";
import { useOrchestratorSessionState } from "./hooks/use-orchestrator-session-state";
import { useRepoSessionReadModel } from "./hooks/use-repo-session-read-model";
import { loadRepoPromptOverrides } from "./runtime/runtime";
import {
  closeProjectedBackgroundQuestions,
  toContextUsage,
} from "./session-read-model/agent-session-live-projection";
import { useClientConnection } from "../../connection/client-connection-react";
import { createAgentOrchestratorDependencies } from "./support/orchestrator-dependencies";
import type { AgentOrchestratorDependencies } from "./support/orchestrator-ports";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

type UseAgentOrchestratorOperationsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
  agentEngine: AgentEnginePort;
  sessionStore?: AgentSessionsStore;
  messageQueues?: AgentMessageQueuesStore;
  /**
   * Keep this object stable. An inline object rebuilds session history callbacks on each render.
   */
  dependencies?: AgentOrchestratorDependencies;
};

export type AgentOrchestratorState = {
  sessionStore: AgentSessionsStore;
  messageQueues: AgentMessageQueuesStore;
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
  sessionStore: store,
  messageQueues: sharedQueues,
  dependencies,
}: UseAgentOrchestratorOperationsArgs): AgentOrchestratorState {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const taskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);
  const connection = useClientConnection();
  const resolvedDependencies = useMemo(
    () => dependencies ?? createAgentOrchestratorDependencies(connection),
    [connection, dependencies],
  );
  const { queryClient, hostPort, liveSessionHostPort } = resolvedDependencies;
  // The host owns every queue for the app lifetime. This store only mirrors them.
  const [messageQueues] = useState(() => sharedQueues ?? createAgentMessageQueuesStore());
  const { sessionStore, taskRef, currentWorkspaceRepoPathRef, repoEpochRef, sessionTurnState } =
    useOrchestratorSessionState({
      workspaceRepoPath,
      tasks,
      historyFreshness: getSessionHistoryFreshnessTracker(queryClient),
      store,
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
        feedback: connection.feedback,
        readSession: sessionStore.getSessionSnapshot,
        ensureSession,
        updateSession,
        updateSessionTodos: (session, updater) =>
          updateSessionTodosQueryData(queryClient, session, updater),
        sessionTurnState,
      }),
    [
      connection.feedback,
      ensureSession,
      queryClient,
      sessionStore,
      sessionTurnState,
      updateSession,
    ],
  );
  const historyReadGeneration = useMemo(() => createSessionHistoryReadGeneration(), []);
  const sessionHistoryLoaders = useMemo(() => {
    const loaderArgs = {
      workspaceRepoPath,
      workspaceId,
      adapter: {
        loadSessionHistory: (input: Parameters<AgentEnginePort["loadSessionHistory"]>[0]) =>
          queryClient.fetchQuery(
            sessionHistoryQueryOptions(input, agentEngine.loadSessionHistory, queryClient),
          ),
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
  const currentSessionReadModel = useRepoSessionReadModel({
    workspaceRepoPath,
    workspaceId,
    taskIds,
    isLoadingTasks,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    commitSessionCollection: sessionStore.commitSessionCollection,
    applyLiveSessionEnvelope: sessionStore.applyLiveSessionEnvelope,
    recordHistoryEnvelope: sessionStore.recordHistoryEnvelope,
    messageQueues,
    liveSessionPort: liveSessionHostPort,
    transcriptEvents,
    queryClient,
    sessionReadPort: hostPort,
    feedback: connection.feedback,
  });
  const sessionActions = useMemo(
    () =>
      createAgentSessionActions({
        feedback: connection.feedback,
        workspaceRepoPath,
        workspaceId,
        adapter: agentEngine,
        messageQueues,
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
      connection.feedback,
      currentWorkspaceRepoPathRef,
      closeBackgroundQuestions,
      messageQueues,
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
        feedback: connection.feedback,
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
      connection.feedback,
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

  return useMemo<AgentOrchestratorState>(
    () => ({
      sessionStore,
      messageQueues,
      operations,
      historyLoadActions,
      readModelState,
    }),
    [historyLoadActions, messageQueues, operations, readModelState, sessionStore],
  );
}
