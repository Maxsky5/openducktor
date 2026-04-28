import type { AgentSessionRecord, RuntimeKind, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentRuntimeConnection } from "@openducktor/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { appQueryClient } from "@/lib/query-client";
import type { AgentSessionsStore } from "@/state/agent-sessions-store";
import { agentSessionQueryKeys } from "@/state/queries/agent-sessions";
import { runtimeQueryKeys } from "@/state/queries/runtime";
import { invalidateRepoTaskQueries } from "@/state/queries/tasks";
import type { AgentSessionHistoryPreludeMode, AgentSessionState } from "@/types/agent-orchestrator";
import type {
  ActiveWorkspace,
  AgentOperationsContextValue,
  AgentStateContextValue,
} from "@/types/state-slices";
import { upsertAgentSessionRecordInQuery } from "../../queries/agent-sessions";
import { upsertAgentSessionInRepoTaskData } from "../../queries/tasks";
import { host } from "../shared/host";
import {
  attachAgentSessionListener,
  createAgentSessionActions,
  createEnsureRuntime,
  createLoadAgentSessions,
  loadRepoDefaultTargetBranch,
  loadRepoPromptOverrides,
  loadTaskDocuments,
  loadTaskWorktree,
  runOrchestratorSideEffect,
  toPersistedSessionRecord,
} from ".";
import { createOrchestratorPublicOperations } from "./handlers/public-operations";
import { useOrchestratorSessionState } from "./hooks/use-orchestrator-session-state";
import { LiveAgentSessionStore } from "./lifecycle/live-agent-session-store";
import { createRepoSessionHydrationService } from "./lifecycle/repo-session-hydration-service";
import { createSessionHydrationOperations } from "./lifecycle/session-hydration-operations";
import {
  deriveAgentSessionViewLifecycle,
  type SessionRepoReadinessState,
} from "./lifecycle/session-view-lifecycle";
import {
  readAssistantActivityStartedAtMsFromMessages,
  resolveAssistantTurnDurationMs,
} from "./support/assistant-turn-duration";
import { mergeHydratedMessages } from "./support/hydrated-message-merge";
import { createRuntimeTranscriptSession } from "./support/runtime-transcript-session";
import { isTranscriptAgentSession } from "./support/session-purpose";
import { clearSubagentPendingPermissionFromSessions } from "./support/subagent-permission-overlay";

const hasAttachedRuntime = (
  session: Pick<AgentSessionState, "runtimeId" | "runtimeRoute"> | null | undefined,
): boolean => {
  if (!session) {
    return false;
  }

  return session.runtimeId !== null || session.runtimeRoute !== null;
};

const withRuntimeRecoveryState = (
  session: AgentSessionState,
  runtimeRecoveryState: NonNullable<AgentSessionState["runtimeRecoveryState"]>,
): AgentSessionState => {
  return session.runtimeRecoveryState === runtimeRecoveryState
    ? session
    : { ...session, runtimeRecoveryState };
};

type UseAgentOrchestratorOperationsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  tasks: TaskCard[];
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
  agentEngine: AgentEnginePort;
};

type UseAgentOrchestratorOperationsResult = AgentStateContextValue & {
  commitSessions: (
    updater:
      | Record<string, AgentSessionState>
      | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
  ) => void;
  retrySessionRuntimeAttachment: (input: {
    taskId: string;
    sessionId: string;
    recoveryDedupKey?: string | null;
    historyPreludeMode?: AgentSessionHistoryPreludeMode;
    allowLiveSessionResume?: boolean;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<boolean>;
  sessionStore: AgentSessionsStore;
  operations: AgentOperationsContextValue;
};

type AttachRuntimeTranscriptSessionInput = Parameters<
  AgentOperationsContextValue["attachRuntimeTranscriptSession"]
>[0];

export function useAgentOrchestratorOperations({
  activeWorkspace,
  tasks,
  refreshTaskData,
  agentEngine,
}: UseAgentOrchestratorOperationsArgs): UseAgentOrchestratorOperationsResult {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { sessionStore, refBridges, commitSessions } = useOrchestratorSessionState({
    activeWorkspace,
    tasks,
  });
  const { sessionsRef, assistantTurnTimingBySessionRef, unsubscribersRef } = refBridges;
  const [sessionRetryTick, setSessionRetryTick] = useState(0);

  const toTimestampMs = useCallback((timestamp: string | number): number | undefined => {
    if (typeof timestamp === "number") {
      return Number.isFinite(timestamp) ? timestamp : undefined;
    }

    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? undefined : parsed;
  }, []);

  const recordTurnActivityTimestamp = useCallback(
    (sessionId: string, timestamp: string | number): void => {
      const timestampMs = toTimestampMs(timestamp);
      if (timestampMs === undefined) {
        return;
      }
      const current = assistantTurnTimingBySessionRef.current[sessionId]?.activityStartedAtMs;
      assistantTurnTimingBySessionRef.current[sessionId] = {
        ...(assistantTurnTimingBySessionRef.current[sessionId] ?? {}),
        activityStartedAtMs:
          typeof current === "number" ? Math.min(current, timestampMs) : timestampMs,
      };
    },
    [assistantTurnTimingBySessionRef, toTimestampMs],
  );

  const recordTurnUserMessageTimestamp = useCallback(
    (sessionId: string, timestamp: string | number): void => {
      const timestampMs = toTimestampMs(timestamp);
      if (timestampMs === undefined) {
        return;
      }
      const current = assistantTurnTimingBySessionRef.current[sessionId]?.userAnchorAtMs;
      assistantTurnTimingBySessionRef.current[sessionId] = {
        ...(assistantTurnTimingBySessionRef.current[sessionId] ?? {}),
        userAnchorAtMs: typeof current === "number" ? Math.min(current, timestampMs) : timestampMs,
      };
    },
    [assistantTurnTimingBySessionRef, toTimestampMs],
  );

  const persistSessionRecord = useCallback(
    async (taskId: string, record: AgentSessionRecord): Promise<void> => {
      if (!workspaceRepoPath) {
        return;
      }
      await host.agentSessionUpsert(workspaceRepoPath, taskId, record);
      upsertAgentSessionRecordInQuery(appQueryClient, workspaceRepoPath, taskId, record);
      upsertAgentSessionInRepoTaskData(appQueryClient, workspaceRepoPath, taskId, record);
    },
    [workspaceRepoPath],
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
      const shouldPersist = options?.persist === true && !isTranscriptAgentSession(current);
      const nextSession = updater(current);
      if (nextSession === current) {
        return;
      }

      let hasChanges = false;
      for (const key of Object.keys(nextSession) as Array<keyof AgentSessionState>) {
        if (nextSession[key] !== current[key]) {
          hasChanges = true;
          break;
        }
      }

      if (!hasChanges) {
        return;
      }

      const nextSessions = {
        ...currentSessions,
        [sessionId]: nextSession,
      };
      commitSessions(nextSessions);

      if (shouldPersist) {
        runOrchestratorSideEffect(
          "operations-persist-session-snapshot",
          persistSessionRecord(nextSession.taskId, toPersistedSessionRecord(nextSession)),
          {
            tags: {
              repoPath: workspaceRepoPath,
              sessionId,
              taskId: nextSession.taskId,
              role: nextSession.role,
            },
          },
        );
      }
    },
    [workspaceRepoPath, commitSessions, persistSessionRecord, sessionsRef],
  );

  const replyRuntimeSessionPermission = useCallback(
    async (input: {
      runtimeKind: RuntimeKind;
      runtimeConnection: AgentRuntimeConnection;
      externalSessionId: string;
      requestId: string;
      reply: "once" | "always" | "reject";
      message?: string;
    }) => {
      await agentEngine.replyRuntimeSessionPermission(input);
      clearSubagentPendingPermissionFromSessions({
        sessionsRef,
        updateSession,
        targetSessionId: input.externalSessionId,
        requestId: input.requestId,
      });
    },
    [agentEngine, sessionsRef, updateSession],
  );

  const resolveTurnDurationMs = useCallback(
    (
      sessionId: string,
      timestamp: string,
      messages: AgentSessionState["messages"] = [],
    ): number | undefined => {
      const completedAtMs = toTimestampMs(timestamp) ?? Date.now();
      const currentTiming = assistantTurnTimingBySessionRef.current[sessionId] ?? {};
      const previousAssistantCompletedAtMs = currentTiming.previousAssistantCompletedAtMs;
      const activityStartedAtMs =
        currentTiming.activityStartedAtMs ??
        readAssistantActivityStartedAtMsFromMessages({
          messages: Array.isArray(messages) ? messages : [],
          previousAssistantCompletedAtMs,
          completedAtMs,
        });
      const userAnchorAtMs = currentTiming.userAnchorAtMs;
      return resolveAssistantTurnDurationMs({
        completedAtMs,
        ...(typeof activityStartedAtMs === "number" ? { activityStartedAtMs } : {}),
        ...(typeof userAnchorAtMs === "number" ? { userAnchorAtMs } : {}),
        ...(typeof previousAssistantCompletedAtMs === "number"
          ? { previousAssistantCompletedAtMs }
          : {}),
      });
    },
    [assistantTurnTimingBySessionRef, toTimestampMs],
  );

  const clearTurnDuration = useCallback(
    (sessionId: string, completedTimestamp?: string): void => {
      const completedAtMs =
        completedTimestamp === undefined ? undefined : toTimestampMs(completedTimestamp);
      const nextTiming = { ...(assistantTurnTimingBySessionRef.current[sessionId] ?? {}) };
      delete nextTiming.activityStartedAtMs;
      delete nextTiming.userAnchorAtMs;
      if (typeof completedAtMs === "number") {
        nextTiming.previousAssistantCompletedAtMs = completedAtMs;
      }
      if (Object.keys(nextTiming).length === 0) {
        delete assistantTurnTimingBySessionRef.current[sessionId];
        return;
      }
      assistantTurnTimingBySessionRef.current[sessionId] = nextTiming;
    },
    [assistantTurnTimingBySessionRef, toTimestampMs],
  );

  const readSessionModelCatalog = useCallback(
    (runtimeKind: RuntimeKind, runtimeConnection: AgentRuntimeConnection) =>
      agentEngine.listAvailableModels({
        runtimeKind,
        runtimeConnection,
      }),
    [agentEngine],
  );

  const readSessionTodos = useCallback(
    (
      runtimeKind: RuntimeKind,
      runtimeConnection: AgentRuntimeConnection,
      externalSessionId: string,
    ) =>
      agentEngine.loadSessionTodos({
        runtimeKind,
        runtimeConnection,
        externalSessionId,
      }),
    [agentEngine],
  );

  const readSessionHistory = useCallback(
    (
      runtimeKind: RuntimeKind,
      runtimeConnection: AgentRuntimeConnection,
      externalSessionId: string,
    ) =>
      agentEngine.loadSessionHistory({
        runtimeKind,
        runtimeConnection,
        externalSessionId,
      }),
    [agentEngine],
  );

  const readSessionSlashCommands = useCallback(
    (runtimeKind: RuntimeKind, runtimeConnection: AgentRuntimeConnection) =>
      agentEngine.listAvailableSlashCommands({
        runtimeKind,
        runtimeConnection,
      }),
    [agentEngine],
  );

  const readSessionFileSearch = useCallback(
    (runtimeKind: RuntimeKind, runtimeConnection: AgentRuntimeConnection, query: string) =>
      agentEngine.searchFiles({
        runtimeKind,
        runtimeConnection,
        query,
      }),
    [agentEngine],
  );

  const removeSessionIds = useCallback(
    (sessionIds: string[]): void => {
      if (sessionIds.length === 0) {
        return;
      }

      for (const sessionId of sessionIds) {
        const unsubscribe = unsubscribersRef.current.get(sessionId);
        unsubscribe?.();
        unsubscribersRef.current.delete(sessionId);

        const flushTimeout = refBridges.draftFlushTimeoutBySessionRef.current[sessionId];
        if (flushTimeout !== undefined) {
          clearTimeout(flushTimeout);
        }
        delete refBridges.draftFlushTimeoutBySessionRef.current[sessionId];
        delete refBridges.draftRawBySessionRef.current[sessionId];
        delete refBridges.draftSourceBySessionRef.current[sessionId];
        delete refBridges.draftMessageIdBySessionRef.current[sessionId];
        delete refBridges.assistantTurnTimingBySessionRef.current[sessionId];
        delete refBridges.turnModelBySessionRef.current[sessionId];
      }

      commitSessions((current) => {
        let hasChanges = false;
        const next = { ...current };
        for (const sessionId of sessionIds) {
          if (next[sessionId]) {
            delete next[sessionId];
            hasChanges = true;
          }
        }
        return hasChanges ? next : current;
      });
    },
    [commitSessions, refBridges, unsubscribersRef],
  );

  const removeAgentSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const session = sessionsRef.current[sessionId];
      if (session && isTranscriptAgentSession(session) && agentEngine.hasSession(sessionId)) {
        await agentEngine.detachSession(sessionId);
      }
      removeSessionIds([sessionId]);
    },
    [agentEngine, removeSessionIds, sessionsRef],
  );

  const removeAgentSessions = useCallback(
    async ({
      taskId,
      roles,
    }: {
      taskId: string;
      roles?: AgentSessionState["role"][];
    }): Promise<void> => {
      const matchingRoles = roles ? new Set(roles) : null;
      const matchingSessions = Object.values(sessionsRef.current).filter(
        (session) =>
          session.taskId === taskId && (matchingRoles === null || matchingRoles.has(session.role)),
      );
      await Promise.all(
        matchingSessions.map(async (session) => {
          if (isTranscriptAgentSession(session) && agentEngine.hasSession(session.sessionId)) {
            await agentEngine.detachSession(session.sessionId);
          }
        }),
      );
      const sessionIds = matchingSessions
        .filter(
          (session, index, sessions) =>
            sessions.findIndex((candidate) => candidate.sessionId === session.sessionId) === index,
        )
        .map((session) => session.sessionId);
      removeSessionIds(sessionIds);
    },
    [agentEngine, removeSessionIds, sessionsRef],
  );

  const liveAgentSessionStore = useMemo(() => new LiveAgentSessionStore(), []);

  const attachSessionListener = useCallback(
    (repoPath: string, sessionId: string): void => {
      if (unsubscribersRef.current.has(sessionId)) {
        return;
      }
      const unsubscribe = attachAgentSessionListener({
        adapter: agentEngine,
        repoPath,
        sessionId,
        sessionsRef: refBridges.sessionsRef,
        draftRawBySessionRef: refBridges.draftRawBySessionRef,
        draftSourceBySessionRef: refBridges.draftSourceBySessionRef,
        draftMessageIdBySessionRef: refBridges.draftMessageIdBySessionRef,
        draftFlushTimeoutBySessionRef: refBridges.draftFlushTimeoutBySessionRef,
        turnStartedAtBySessionRef: refBridges.turnStartedAtBySessionRef,
        turnModelBySessionRef: refBridges.turnModelBySessionRef,
        updateSession,
        isSessionListenerAttached: (candidateSessionId) =>
          candidateSessionId === sessionId || unsubscribersRef.current.has(candidateSessionId),
        recordTurnActivityTimestamp,
        recordTurnUserMessageTimestamp,
        resolveTurnDurationMs,
        clearTurnDuration,
        refreshTaskData,
        resolveRuntimeDefinition: (runtimeKind) =>
          findRuntimeDefinition(agentEngine.listRuntimeDefinitions(), runtimeKind),
      });

      unsubscribersRef.current.set(sessionId, unsubscribe);
    },
    [
      agentEngine,
      clearTurnDuration,
      refBridges,
      refreshTaskData,
      recordTurnActivityTimestamp,
      recordTurnUserMessageTimestamp,
      resolveTurnDurationMs,
      unsubscribersRef,
      updateSession,
    ],
  );

  const attachRuntimeTranscriptSession = useCallback(
    async (input: AttachRuntimeTranscriptSessionInput): Promise<void> => {
      const existingSession = sessionsRef.current[input.sessionId];
      if (existingSession && !isTranscriptAgentSession(existingSession)) {
        throw new Error(`Session ${input.sessionId} is already active and is not a transcript.`);
      }

      const hadLocalSession = existingSession !== undefined;
      const hadRuntimeSession = agentEngine.hasSession(input.sessionId);
      let attachedListener = false;
      if (hadLocalSession && hadRuntimeSession) {
        attachSessionListener(input.repoPath, input.sessionId);
        return;
      }
      if (!hadLocalSession) {
        const initialSession = createRuntimeTranscriptSession({
          repoPath: input.repoPath,
          sessionId: input.sessionId,
          externalSessionId: input.externalSessionId,
          runtimeKind: input.runtimeKind,
          runtimeId: input.runtimeId,
          runtimeConnection: input.runtimeConnection,
          history: [],
          isLive: true,
          pendingPermissions: input.pendingPermissions ?? [],
        });
        commitSessions((current) => ({
          ...current,
          [input.sessionId]: initialSession,
        }));
      }

      try {
        const summary = hadRuntimeSession
          ? null
          : await agentEngine.attachSession({
              sessionId: input.sessionId,
              externalSessionId: input.externalSessionId,
              repoPath: input.repoPath,
              runtimeKind: input.runtimeKind,
              ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
              runtimeConnection: input.runtimeConnection,
              workingDirectory: input.runtimeConnection.workingDirectory,
              taskId: "",
              role: "build",
              scenario: "build_implementation_start",
              systemPrompt: "",
            });

        attachSessionListener(input.repoPath, input.sessionId);
        attachedListener = true;

        const history = await agentEngine.loadSessionHistory({
          runtimeKind: input.runtimeKind,
          runtimeConnection: input.runtimeConnection,
          externalSessionId: input.externalSessionId,
        });
        const hydratedSession = createRuntimeTranscriptSession({
          repoPath: input.repoPath,
          sessionId: input.sessionId,
          externalSessionId: input.externalSessionId,
          runtimeKind: input.runtimeKind,
          runtimeId: input.runtimeId,
          runtimeConnection: input.runtimeConnection,
          history,
          isLive: true,
          pendingPermissions: input.pendingPermissions ?? [],
        });

        updateSession(
          input.sessionId,
          (current) => ({
            ...current,
            startedAt: summary?.startedAt ?? hydratedSession.startedAt,
            status: summary?.status ?? current.status,
            runtimeKind: input.runtimeKind,
            runtimeId: input.runtimeId,
            runtimeRoute: hydratedSession.runtimeRoute,
            workingDirectory: input.runtimeConnection.workingDirectory,
            historyHydrationState: "hydrated",
            runtimeRecoveryState: "idle",
            messages: mergeHydratedMessages(
              input.sessionId,
              hydratedSession.messages,
              current.messages,
            ),
          }),
          { persist: false },
        );
      } catch (error) {
        if (attachedListener && !hadLocalSession) {
          const unsubscribe = unsubscribersRef.current.get(input.sessionId);
          unsubscribe?.();
          unsubscribersRef.current.delete(input.sessionId);
        }
        if (!hadRuntimeSession && agentEngine.hasSession(input.sessionId)) {
          await agentEngine.detachSession(input.sessionId);
        }
        if (!hadLocalSession) {
          removeSessionIds([input.sessionId]);
        }
        throw error;
      }
    },
    [
      agentEngine,
      attachSessionListener,
      commitSessions,
      removeSessionIds,
      sessionsRef,
      unsubscribersRef,
      updateSession,
    ],
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
        loadRepoPromptOverrides,
        loadTaskDocuments,
        liveAgentSessionStore,
      }),
    [
      activeWorkspace,
      agentEngine,
      attachSessionListener,
      commitSessions,
      liveAgentSessionStore,
      refBridges,
      updateSession,
    ],
  );

  const sessionHydration = useMemo(
    () =>
      createSessionHydrationOperations({
        loadAgentSessions,
        getSessionSnapshot: (sessionId) => sessionsRef.current[sessionId],
      }),
    [loadAgentSessions, sessionsRef],
  );

  const retrySessionRuntimeAttachment = useCallback(
    async ({
      taskId,
      sessionId,
      recoveryDedupKey,
      historyPreludeMode,
      allowLiveSessionResume,
      persistedRecords,
    }: {
      taskId: string;
      sessionId: string;
      recoveryDedupKey?: string | null;
      historyPreludeMode?: AgentSessionHistoryPreludeMode;
      allowLiveSessionResume?: boolean;
      persistedRecords?: AgentSessionRecord[];
    }): Promise<boolean> => {
      updateSession(
        sessionId,
        (current) => withRuntimeRecoveryState(current, "recovering_runtime"),
        { persist: false },
      );

      let attached = false;
      try {
        attached = await sessionHydration.recoverSessionRuntimeAndHydrateRequestedTaskSession({
          taskId,
          sessionId,
          ...(recoveryDedupKey ? { recoveryDedupKey } : {}),
          ...(historyPreludeMode ? { historyPreludeMode } : {}),
          ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
          ...(persistedRecords ? { persistedRecords } : {}),
        });
      } catch (error) {
        attached = hasAttachedRuntime(sessionsRef.current[sessionId]);
        updateSession(
          sessionId,
          (current) => withRuntimeRecoveryState(current, attached ? "idle" : "failed"),
          { persist: false },
        );
        throw error;
      }

      attached = hasAttachedRuntime(sessionsRef.current[sessionId]);
      updateSession(
        sessionId,
        (current) => withRuntimeRecoveryState(current, attached ? "idle" : "waiting_for_runtime"),
        { persist: false },
      );

      return attached;
    },
    [sessionHydration, sessionsRef, updateSession],
  );

  const ensureSessionReadyForView = useCallback(
    async ({
      taskId,
      sessionId,
      repoReadinessState,
      recoveryDedupKey,
      historyPreludeMode,
      allowLiveSessionResume,
      persistedRecords,
    }: {
      taskId: string;
      sessionId: string;
      repoReadinessState: SessionRepoReadinessState;
      recoveryDedupKey?: string | null;
      historyPreludeMode?: AgentSessionHistoryPreludeMode;
      allowLiveSessionResume?: boolean;
      persistedRecords?: AgentSessionRecord[];
    }): Promise<boolean> => {
      const session = sessionsRef.current[sessionId] ?? null;
      const lifecycle = deriveAgentSessionViewLifecycle({
        session,
        repoReadinessState,
      });

      if (!session || !lifecycle.shouldEnsureReadyForView) {
        return lifecycle.phase === "ready";
      }

      if (lifecycle.phase === "waiting_for_runtime_attachment") {
        return retrySessionRuntimeAttachment({
          taskId,
          sessionId,
          ...(recoveryDedupKey ? { recoveryDedupKey } : {}),
          ...(historyPreludeMode ? { historyPreludeMode } : {}),
          ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
          ...(persistedRecords ? { persistedRecords } : {}),
        });
      }

      await sessionHydration.hydrateRequestedTaskSession({
        taskId,
        sessionId,
        ...(historyPreludeMode ? { historyPreludeMode } : {}),
        ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
        ...(persistedRecords ? { persistedRecords } : {}),
      });
      return true;
    },
    [retrySessionRuntimeAttachment, sessionHydration, sessionsRef],
  );

  const repoSessionHydrationService = useMemo(
    () =>
      createRepoSessionHydrationService({
        agentEngine,
        sessionHydration,
        liveAgentSessionStore,
        onRetryRequested: () => {
          setSessionRetryTick((current) => current + 1);
        },
      }),
    [agentEngine, liveAgentSessionStore, sessionHydration],
  );

  const isCurrentActiveRepo = useCallback(
    (repoPath: string): boolean => refBridges.currentWorkspaceRepoPathRef.current === repoPath,
    [refBridges],
  );

  useEffect(() => {
    return () => repoSessionHydrationService.dispose();
  }, [repoSessionHydrationService]);

  useEffect(() => {
    if (!workspaceRepoPath) {
      return;
    }
    repoSessionHydrationService.resetRepo(workspaceRepoPath);
  }, [workspaceRepoPath, repoSessionHydrationService]);

  useEffect(() => {
    if (!workspaceRepoPath) {
      return;
    }
    // Explicitly reference the retry tick: this effect must rerun when a delayed retry fires.
    void sessionRetryTick;

    let cancelled = false;

    void (async () => {
      await repoSessionHydrationService.bootstrapPendingTasks({
        repoPath: workspaceRepoPath,
        tasks,
        isCancelled: () => cancelled,
        isCurrentRepo: isCurrentActiveRepo,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    workspaceRepoPath,
    isCurrentActiveRepo,
    repoSessionHydrationService,
    sessionRetryTick,
    tasks,
  ]);

  useEffect(() => {
    if (!workspaceRepoPath || tasks.length === 0) {
      return;
    }
    // Explicitly reference the retry tick: this effect must rerun when a delayed retry fires.
    void sessionRetryTick;
    let cancelled = false;

    void (async () => {
      await repoSessionHydrationService.reconcilePendingTasks({
        repoPath: workspaceRepoPath,
        tasks,
        isCancelled: () => cancelled,
        isCurrentRepo: isCurrentActiveRepo,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    workspaceRepoPath,
    isCurrentActiveRepo,
    repoSessionHydrationService,
    sessionRetryTick,
    tasks,
  ]);

  const ensureRuntime = useMemo(
    () =>
      createEnsureRuntime({
        refreshTaskData,
      }),
    [refreshTaskData],
  );

  const invalidateSessionStopQueries = useCallback(
    async ({
      repoPath,
      taskId,
      runtimeKind,
    }: {
      repoPath: string;
      taskId: string;
      runtimeKind?: RuntimeKind;
    }): Promise<void> => {
      await Promise.all([
        invalidateRepoTaskQueries(appQueryClient, repoPath),
        appQueryClient.invalidateQueries({
          queryKey: agentSessionQueryKeys.list(repoPath, taskId),
          exact: true,
          refetchType: "none",
        }),
        ...(runtimeKind
          ? [
              appQueryClient.invalidateQueries({
                queryKey: runtimeQueryKeys.list(runtimeKind, repoPath),
                exact: true,
                refetchType: "none",
              }),
            ]
          : []),
      ]);
    },
    [],
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
        resolveTaskWorktree: async (repoPath, taskId) => loadTaskWorktree(repoPath, taskId),
        ensureRuntime,
        loadTaskDocuments,
        loadRepoPromptOverrides,
        loadRepoDefaultTargetBranch,
        loadAgentSessions,
        clearTurnDuration,
        refreshTaskData,
        persistSessionRecord,
        stopAuthoritativeSession: async (target) => {
          await host.agentSessionStop(target);
        },
        invalidateSessionStopQueries,
      }),
    [
      activeWorkspace,
      agentEngine,
      attachSessionListener,
      clearTurnDuration,
      commitSessions,
      ensureRuntime,
      loadAgentSessions,
      invalidateSessionStopQueries,
      persistSessionRecord,
      refBridges,
      refreshTaskData,
      updateSession,
    ],
  );

  return useMemo<UseAgentOrchestratorOperationsResult>(() => {
    const operations = createOrchestratorPublicOperations({
      bootstrapTaskSessions: sessionHydration.bootstrapTaskSessions,
      hydrateRequestedTaskSessionHistory: sessionHydration.hydrateRequestedTaskSession,
      ensureSessionReadyForView,
      reconcileLiveTaskSessions: sessionHydration.reconcileLiveTaskSessions,
      loadAgentSessions,
      readSessionModelCatalog,
      readSessionTodos,
      readSessionHistory,
      attachRuntimeTranscriptSession,
      readSessionSlashCommands,
      readSessionFileSearch,
      replyRuntimeSessionPermission,
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
    readSessionModelCatalog,
    readSessionTodos,
    readSessionHistory,
    attachRuntimeTranscriptSession,
    retrySessionRuntimeAttachment,
    ensureSessionReadyForView,
    readSessionSlashCommands,
    readSessionFileSearch,
    replyRuntimeSessionPermission,
    removeAgentSessions,
    removeAgentSession,
    sessionActions,
  ]);
}
