import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { useCallback, useMemo, useState } from "react";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import {
  type AgentSessionReadModelLoadState,
  idleAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import type {
  ActiveWorkspace,
  AgentOperationsContextValue,
  AgentSessionReadModelStateContextValue,
  AgentStateContextValue,
} from "@/types/state-slices";
import type { UpdateSession } from "./events/session-event-types";
import { createOrchestratorPublicOperations } from "./handlers/public-operations";
import { createAgentSessionActions } from "./handlers/session-actions";
import { useAgentSessionObservers } from "./hooks/use-agent-session-observers";
import { useOrchestratorSessionState } from "./hooks/use-orchestrator-session-state";
import { useRepoSessionReadModelEffects } from "./hooks/use-repo-session-read-model-effects";
import { createLoadAgentSessions } from "./lifecycle/load-sessions";
import { createLoadAgentSessionHistory } from "./lifecycle/session-history-loader";
import { createEnsureRuntime, loadRepoPromptOverrides, loadTaskDocuments } from "./runtime/runtime";
import { runOrchestratorSideEffect } from "./support/async-side-effects";
import { createDefaultAgentOrchestratorDependencies } from "./support/orchestrator-dependency-defaults";
import type { AgentOrchestratorDependencies } from "./support/orchestrator-ports";
import { toPersistedSessionRecord } from "./support/persistence";
import { createSessionCacheEffects } from "./support/session-cache-effects";
import { isWorkflowAgentSession } from "./support/workflow-session";

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
  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const [sessionReadModelLoadState, setSessionReadModelLoadState] =
    useState<AgentSessionReadModelLoadState>(idleAgentSessionReadModelLoadState);
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
    sessionTransientState,
  } = useOrchestratorSessionState({
    workspaceRepoPath,
    tasks,
  });
  const sessionCacheEffects = useMemo(
    () => createSessionCacheEffects({ workspaceRepoPath, queryClient, hostPort }),
    [workspaceRepoPath, queryClient, hostPort],
  );
  const { persistSessionRecord, invalidateSessionStopQueries } = sessionCacheEffects;
  const { assistantTurnTiming } = sessionTransientState;
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
  const queryBackedPromptOverrides = useCallback(
    (workspaceId: string) => loadRepoPromptOverrides(workspaceId, { queryClient }),
    [queryClient],
  );
  const { observeAgentSession, removeAgentSession, removeAgentSessions } = useAgentSessionObservers(
    {
      agentEngine,
      workspaceId,
      loadRepoPromptOverrides: queryBackedPromptOverrides,
      sessionObserversRef,
      sessionTransientState,
      readSessions: sessionStore.getSessionsSnapshot,
      readSession: sessionStore.getSessionSnapshot,
      setSessionCollection: sessionStore.setSessionCollection,
      updateSession,
      queryClient,
      recordTurnActivityTimestamp: assistantTurnTiming.recordTurnActivityTimestamp,
      recordTurnUserMessageTimestamp: assistantTurnTiming.recordTurnUserMessageTimestamp,
      resolveTurnDurationMs: assistantTurnTiming.resolveTurnDurationMs,
      clearTurnDuration: assistantTurnTiming.clearTurnDuration,
      refreshTaskData,
    },
  );
  const loadAgentSessions = useMemo(
    () =>
      createLoadAgentSessions({
        workspaceRepoPath,
        adapter: agentEngine,
        repoEpochRef,
        currentWorkspaceRepoPathRef,
        readSessionCollection: sessionStore.getSessionCollectionSnapshot,
        setSessionCollection: sessionStore.setSessionCollection,
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
  const loadAgentSessionHistory = useMemo(
    () =>
      createLoadAgentSessionHistory({
        workspaceRepoPath,
        workspaceId,
        adapter: agentEngine,
        repoEpochRef,
        currentWorkspaceRepoPathRef,
        readSessionSnapshot: sessionStore.getSessionSnapshot,
        updateSession,
        taskRef,
        loadRepoPromptOverrides: queryBackedPromptOverrides,
      }),
    [
      agentEngine,
      currentWorkspaceRepoPathRef,
      queryBackedPromptOverrides,
      repoEpochRef,
      sessionStore,
      taskRef,
      updateSession,
      workspaceId,
      workspaceRepoPath,
    ],
  );
  useRepoSessionReadModelEffects({
    workspaceRepoPath,
    tasks,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    readSessionCollection: sessionStore.getSessionCollectionSnapshot,
    setSessionCollection: sessionStore.setSessionCollection,
    agentEngine,
    observeAgentSession,
    setSessionReadModelLoadState,
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
        workspaceRepoPath,
        workspaceId,
        adapter: agentEngine,
        setSessionCollection: sessionStore.setSessionCollection,
        readSessionSnapshot: sessionStore.getSessionSnapshot,
        taskRef,
        repoEpochRef,
        currentWorkspaceRepoPathRef,
        sessionStartGateRef,
        sessionObserversRef,
        sessionTransientState,
        recordTurnUserMessageTimestamp: assistantTurnTiming.recordTurnUserMessageTimestamp,
        readTurnUserMessageStartedAtMs: assistantTurnTiming.readTurnUserMessageStartedAtMs,
        updateSession,
        observeAgentSession,
        resolveTaskWorktree: hostPort.taskWorktreeGet,
        ensureRuntime,
        loadTaskDocuments,
        loadRepoPromptOverrides: queryBackedPromptOverrides,
        loadAgentSessions,
        loadAgentSessionHistory,
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
      loadAgentSessionHistory,
      loadAgentSessions,
      observeAgentSession,
      persistSessionRecord,
      queryBackedPromptOverrides,
      repoEpochRef,
      refreshTaskData,
      sessionObserversRef,
      sessionStore,
      sessionStartGateRef,
      sessionTransientState,
      taskRef,
      assistantTurnTiming.recordTurnUserMessageTimestamp,
      assistantTurnTiming.readTurnUserMessageStartedAtMs,
      updateSession,
      workspaceId,
      workspaceRepoPath,
    ],
  );
  return useMemo<UseAgentOrchestratorOperationsResult>(() => {
    const readModelState = { sessionReadModelLoadState };
    const operations = createOrchestratorPublicOperations({
      loadAgentSessions,
      loadAgentSessionHistory: async (session) => {
        await loadAgentSessionHistory(session);
      },
      agentEngine,
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
      sessionStore,
      operations,
      readModelState,
    };
  }, [
    sessionReadModelLoadState,
    sessionStore,
    agentEngine,
    loadAgentSessions,
    loadAgentSessionHistory,
    removeAgentSessions,
    removeAgentSession,
    sessionActions,
  ]);
}
