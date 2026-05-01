import type { AgentSessionRecord, RuntimeKind, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort, AgentRole } from "@openducktor/core";
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
import { getSessionMessageCount } from "./support/messages";
import { createRuntimeTranscriptSession } from "./support/runtime-transcript-session";
import { isTranscriptAgentSession } from "./support/session-purpose";

const hasAttachedRuntime = (
  session: Pick<AgentSessionState, "runtimeId"> | null | undefined,
): boolean => {
  if (!session) {
    return false;
  }

  return !!session.runtimeId;
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
    externalSessionId: string;
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
    (externalSessionId: string, timestamp: string | number): void => {
      const timestampMs = toTimestampMs(timestamp);
      if (timestampMs === undefined) {
        return;
      }
      const current =
        assistantTurnTimingBySessionRef.current[externalSessionId]?.activityStartedAtMs;
      assistantTurnTimingBySessionRef.current[externalSessionId] = {
        ...(assistantTurnTimingBySessionRef.current[externalSessionId] ?? {}),
        activityStartedAtMs:
          typeof current === "number" ? Math.min(current, timestampMs) : timestampMs,
      };
    },
    [assistantTurnTimingBySessionRef, toTimestampMs],
  );

  const recordTurnUserMessageTimestamp = useCallback(
    (externalSessionId: string, timestamp: string | number): void => {
      const timestampMs = toTimestampMs(timestamp);
      if (timestampMs === undefined) {
        return;
      }
      const current = assistantTurnTimingBySessionRef.current[externalSessionId]?.userAnchorAtMs;
      assistantTurnTimingBySessionRef.current[externalSessionId] = {
        ...(assistantTurnTimingBySessionRef.current[externalSessionId] ?? {}),
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
      externalSessionId: string,
      updater: (current: AgentSessionState) => AgentSessionState,
      options?: { persist?: boolean },
    ): void => {
      const currentSessions = sessionsRef.current;
      const current = currentSessions[externalSessionId];
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
        [externalSessionId]: nextSession,
      };
      commitSessions(nextSessions);

      if (shouldPersist) {
        runOrchestratorSideEffect(
          "operations-persist-session-snapshot",
          persistSessionRecord(nextSession.taskId, toPersistedSessionRecord(nextSession)),
          {
            tags: {
              repoPath: workspaceRepoPath,
              externalSessionId,
              taskId: nextSession.taskId,
              role: nextSession.role,
            },
          },
        );
      }
    },
    [workspaceRepoPath, commitSessions, persistSessionRecord, sessionsRef],
  );

  const resolveTurnDurationMs = useCallback(
    (
      externalSessionId: string,
      timestamp: string,
      messages: AgentSessionState["messages"] = [],
    ): number | undefined => {
      const completedAtMs = toTimestampMs(timestamp) ?? Date.now();
      const currentTiming = assistantTurnTimingBySessionRef.current[externalSessionId] ?? {};
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
    (externalSessionId: string, completedTimestamp?: string): void => {
      const completedAtMs =
        completedTimestamp === undefined ? undefined : toTimestampMs(completedTimestamp);
      const nextTiming = { ...(assistantTurnTimingBySessionRef.current[externalSessionId] ?? {}) };
      delete nextTiming.activityStartedAtMs;
      delete nextTiming.userAnchorAtMs;
      if (typeof completedAtMs === "number") {
        nextTiming.previousAssistantCompletedAtMs = completedAtMs;
      }
      if (Object.keys(nextTiming).length === 0) {
        delete assistantTurnTimingBySessionRef.current[externalSessionId];
        return;
      }
      assistantTurnTimingBySessionRef.current[externalSessionId] = nextTiming;
    },
    [assistantTurnTimingBySessionRef, toTimestampMs],
  );

  const readSessionModelCatalog = useCallback(
    (repoPath: string, runtimeKind: RuntimeKind) =>
      agentEngine.listAvailableModels({
        repoPath,
        runtimeKind,
      }),
    [agentEngine],
  );

  const readSessionTodos = useCallback(
    (
      repoPath: string,
      runtimeKind: RuntimeKind,
      workingDirectory: string,
      externalSessionId: string,
    ) =>
      agentEngine.loadSessionTodos({
        repoPath,
        runtimeKind,
        workingDirectory,
        externalSessionId,
      }),
    [agentEngine],
  );

  const readSessionHistory = useCallback(
    (
      repoPath: string,
      runtimeKind: RuntimeKind,
      workingDirectory: string,
      externalSessionId: string,
    ) =>
      agentEngine.loadSessionHistory({
        repoPath,
        runtimeKind,
        workingDirectory,
        externalSessionId,
      }),
    [agentEngine],
  );

  const readSessionSlashCommands = useCallback(
    (repoPath: string, runtimeKind: RuntimeKind) =>
      agentEngine.listAvailableSlashCommands({
        repoPath,
        runtimeKind,
      }),
    [agentEngine],
  );

  const readSessionFileSearch = useCallback(
    (repoPath: string, runtimeKind: RuntimeKind, workingDirectory: string, query: string) =>
      agentEngine.searchFiles({
        repoPath,
        runtimeKind,
        workingDirectory,
        query,
      }),
    [agentEngine],
  );

  const removeSessionIds = useCallback(
    (externalSessionIds: string[]): void => {
      if (externalSessionIds.length === 0) {
        return;
      }

      for (const externalSessionId of externalSessionIds) {
        const unsubscribe = unsubscribersRef.current.get(externalSessionId);
        unsubscribe?.();
        unsubscribersRef.current.delete(externalSessionId);

        const flushTimeout = refBridges.draftFlushTimeoutBySessionRef.current[externalSessionId];
        if (flushTimeout !== undefined) {
          clearTimeout(flushTimeout);
        }
        delete refBridges.draftFlushTimeoutBySessionRef.current[externalSessionId];
        delete refBridges.draftRawBySessionRef.current[externalSessionId];
        delete refBridges.draftSourceBySessionRef.current[externalSessionId];
        delete refBridges.draftMessageIdBySessionRef.current[externalSessionId];
        delete refBridges.assistantTurnTimingBySessionRef.current[externalSessionId];
        delete refBridges.turnModelBySessionRef.current[externalSessionId];
      }

      commitSessions((current) => {
        let hasChanges = false;
        const next = { ...current };
        for (const externalSessionId of externalSessionIds) {
          if (next[externalSessionId]) {
            delete next[externalSessionId];
            hasChanges = true;
          }
        }
        return hasChanges ? next : current;
      });
    },
    [commitSessions, refBridges, unsubscribersRef],
  );

  const removeAgentSession = useCallback(
    async (externalSessionId: string): Promise<void> => {
      const session = sessionsRef.current[externalSessionId];
      if (
        session &&
        isTranscriptAgentSession(session) &&
        agentEngine.hasSession(externalSessionId)
      ) {
        await agentEngine.detachSession(externalSessionId);
      }
      removeSessionIds([externalSessionId]);
    },
    [agentEngine, removeSessionIds, sessionsRef],
  );

  const removeAgentSessions = useCallback(
    async ({ taskId, roles }: { taskId: string; roles?: AgentRole[] }): Promise<void> => {
      const matchingRoles = roles ? new Set(roles) : null;
      const matchingSessions = Object.values(sessionsRef.current).filter(
        (session) =>
          session.taskId === taskId &&
          (matchingRoles === null || (session.role !== null && matchingRoles.has(session.role))),
      );
      await Promise.all(
        matchingSessions.map(async (session) => {
          if (
            isTranscriptAgentSession(session) &&
            agentEngine.hasSession(session.externalSessionId)
          ) {
            await agentEngine.detachSession(session.externalSessionId);
          }
        }),
      );
      const externalSessionIds = matchingSessions
        .filter(
          (session, index, sessions) =>
            sessions.findIndex(
              (candidate) => candidate.externalSessionId === session.externalSessionId,
            ) === index,
        )
        .map((session) => session.externalSessionId);
      removeSessionIds(externalSessionIds);
    },
    [agentEngine, removeSessionIds, sessionsRef],
  );

  const liveAgentSessionStore = useMemo(() => new LiveAgentSessionStore(), []);

  const attachSessionListener = useCallback(
    (repoPath: string, externalSessionId: string): void => {
      if (unsubscribersRef.current.has(externalSessionId)) {
        return;
      }
      const unsubscribe = attachAgentSessionListener({
        adapter: agentEngine,
        repoPath,
        externalSessionId,
        sessionsRef: refBridges.sessionsRef,
        draftRawBySessionRef: refBridges.draftRawBySessionRef,
        draftSourceBySessionRef: refBridges.draftSourceBySessionRef,
        draftMessageIdBySessionRef: refBridges.draftMessageIdBySessionRef,
        draftFlushTimeoutBySessionRef: refBridges.draftFlushTimeoutBySessionRef,
        turnStartedAtBySessionRef: refBridges.turnStartedAtBySessionRef,
        turnModelBySessionRef: refBridges.turnModelBySessionRef,
        updateSession,
        isSessionListenerAttached: (candidateSessionId) =>
          candidateSessionId === externalSessionId ||
          unsubscribersRef.current.has(candidateSessionId),
        recordTurnActivityTimestamp,
        recordTurnUserMessageTimestamp,
        resolveTurnDurationMs,
        clearTurnDuration,
        refreshTaskData,
        resolveRuntimeDefinition: (runtimeKind) =>
          findRuntimeDefinition(agentEngine.listRuntimeDefinitions(), runtimeKind),
      });

      unsubscribersRef.current.set(externalSessionId, unsubscribe);
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
      const existingSession = sessionsRef.current[input.externalSessionId];
      if (existingSession && !isTranscriptAgentSession(existingSession)) {
        throw new Error(
          `Session ${input.externalSessionId} is already active and is not a transcript.`,
        );
      }
      const runtimeId = input.runtimeId?.trim() || null;
      if (!runtimeId) {
        throw new Error("Runtime identity is unavailable for this transcript.");
      }

      const hadRuntimeSession = agentEngine.hasSession(input.externalSessionId);
      let attachedListener = false;
      const unsubscribeTranscriptListener = (): void => {
        const unsubscribe = unsubscribersRef.current.get(input.externalSessionId);
        unsubscribe?.();
        unsubscribersRef.current.delete(input.externalSessionId);
      };
      const detachRuntimeSessionIfPresent = async (): Promise<void> => {
        unsubscribeTranscriptListener();
        if (agentEngine.hasSession(input.externalSessionId)) {
          await agentEngine.detachSession(input.externalSessionId);
        }
      };
      const isCurrentTranscriptRequest = (): boolean => {
        const current = sessionsRef.current[input.externalSessionId];
        return (
          current !== undefined &&
          isTranscriptAgentSession(current) &&
          current.externalSessionId === input.externalSessionId &&
          current.runtimeKind === input.runtimeKind &&
          current.runtimeId === runtimeId
        );
      };
      const hasMatchingLocalSession = isCurrentTranscriptRequest();
      const hadLocalSession = hasMatchingLocalSession;
      if (existingSession && hadRuntimeSession && !hasMatchingLocalSession) {
        throw new Error(
          "Transcript session identity does not match the requested runtime session.",
        );
      }
      if (hasMatchingLocalSession && hadRuntimeSession) {
        attachSessionListener(input.repoPath, input.externalSessionId);
        return;
      }
      if (!hasMatchingLocalSession) {
        unsubscribeTranscriptListener();
        const initialSession = createRuntimeTranscriptSession({
          repoPath: input.repoPath,
          externalSessionId: input.externalSessionId,
          runtimeKind: input.runtimeKind,
          runtimeId,
          workingDirectory: input.workingDirectory,
          history: [],
          isLive: true,
          pendingPermissions: input.pendingPermissions ?? [],
          pendingQuestions: input.pendingQuestions ?? [],
        });
        commitSessions((current) => ({
          ...current,
          [input.externalSessionId]: initialSession,
        }));
      }

      try {
        const summaryPromise = hadRuntimeSession
          ? Promise.resolve(null)
          : agentEngine.attachSession({
              externalSessionId: input.externalSessionId,
              repoPath: input.repoPath,
              runtimeKind: input.runtimeKind,
              runtimeId,
              workingDirectory: input.workingDirectory,
              purpose: "transcript",
              taskId: "",
              role: null,
              systemPrompt: "",
            });

        attachSessionListener(input.repoPath, input.externalSessionId);
        attachedListener = true;
        const summary = await summaryPromise;
        if (!isCurrentTranscriptRequest()) {
          await detachRuntimeSessionIfPresent();
          return;
        }

        const history = await agentEngine.loadSessionHistory({
          repoPath: input.repoPath,
          runtimeKind: input.runtimeKind,
          workingDirectory: input.workingDirectory,
          externalSessionId: input.externalSessionId,
        });
        if (!isCurrentTranscriptRequest()) {
          await detachRuntimeSessionIfPresent();
          return;
        }
        const hydratedSession = createRuntimeTranscriptSession({
          repoPath: input.repoPath,
          externalSessionId: input.externalSessionId,
          runtimeKind: input.runtimeKind,
          runtimeId,
          workingDirectory: input.workingDirectory,
          history,
          isLive: true,
          pendingPermissions: input.pendingPermissions ?? [],
          pendingQuestions: input.pendingQuestions ?? [],
        });

        updateSession(
          input.externalSessionId,
          (current) => {
            const messages =
              getSessionMessageCount(current) === 0
                ? hydratedSession.messages
                : mergeHydratedMessages(
                    input.externalSessionId,
                    hydratedSession.messages,
                    current.messages,
                  );

            return {
              ...current,
              startedAt: summary?.startedAt ?? hydratedSession.startedAt,
              status: summary?.status ?? current.status,
              runtimeKind: input.runtimeKind,
              runtimeId,
              workingDirectory: input.workingDirectory,
              historyHydrationState: "hydrated",
              runtimeRecoveryState: "idle",
              pendingPermissions: current.pendingPermissions,
              pendingQuestions: current.pendingQuestions,
              messages,
            };
          },
          { persist: false },
        );
      } catch (error) {
        if (attachedListener && !hadLocalSession) {
          unsubscribeTranscriptListener();
        }
        if (!hadRuntimeSession && agentEngine.hasSession(input.externalSessionId)) {
          await agentEngine.detachSession(input.externalSessionId);
        }
        if (!hadLocalSession) {
          removeSessionIds([input.externalSessionId]);
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
        getSessionSnapshot: (externalSessionId) => sessionsRef.current[externalSessionId],
      }),
    [loadAgentSessions, sessionsRef],
  );

  const retrySessionRuntimeAttachment = useCallback(
    async ({
      taskId,
      externalSessionId,
      recoveryDedupKey,
      historyPreludeMode,
      allowLiveSessionResume,
      persistedRecords,
    }: {
      taskId: string;
      externalSessionId: string;
      recoveryDedupKey?: string | null;
      historyPreludeMode?: AgentSessionHistoryPreludeMode;
      allowLiveSessionResume?: boolean;
      persistedRecords?: AgentSessionRecord[];
    }): Promise<boolean> => {
      updateSession(
        externalSessionId,
        (current) => withRuntimeRecoveryState(current, "recovering_runtime"),
        { persist: false },
      );

      let attached = false;
      try {
        attached = await sessionHydration.recoverSessionRuntimeAndHydrateRequestedTaskSession({
          taskId,
          externalSessionId,
          ...(recoveryDedupKey ? { recoveryDedupKey } : {}),
          ...(historyPreludeMode ? { historyPreludeMode } : {}),
          ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
          ...(persistedRecords ? { persistedRecords } : {}),
        });
      } catch (error) {
        attached = hasAttachedRuntime(sessionsRef.current[externalSessionId]);
        updateSession(
          externalSessionId,
          (current) => withRuntimeRecoveryState(current, attached ? "idle" : "failed"),
          { persist: false },
        );
        throw error;
      }

      attached = hasAttachedRuntime(sessionsRef.current[externalSessionId]);
      updateSession(
        externalSessionId,
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
      externalSessionId,
      repoReadinessState,
      recoveryDedupKey,
      historyPreludeMode,
      allowLiveSessionResume,
      persistedRecords,
    }: {
      taskId: string;
      externalSessionId: string;
      repoReadinessState: SessionRepoReadinessState;
      recoveryDedupKey?: string | null;
      historyPreludeMode?: AgentSessionHistoryPreludeMode;
      allowLiveSessionResume?: boolean;
      persistedRecords?: AgentSessionRecord[];
    }): Promise<boolean> => {
      const session = sessionsRef.current[externalSessionId] ?? null;
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
          externalSessionId,
          ...(recoveryDedupKey ? { recoveryDedupKey } : {}),
          ...(historyPreludeMode ? { historyPreludeMode } : {}),
          ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
          ...(persistedRecords ? { persistedRecords } : {}),
        });
      }

      await sessionHydration.hydrateRequestedTaskSession({
        taskId,
        externalSessionId,
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
        sessionHydration,
        liveAgentSessionStore,
        onRetryRequested: () => {
          setSessionRetryTick((current) => current + 1);
        },
      }),
    [liveAgentSessionStore, sessionHydration],
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
    removeAgentSessions,
    removeAgentSession,
    sessionActions,
  ]);
}
