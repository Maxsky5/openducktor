import type { AgentSessionRecord, TaskCard } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentSessionHistoryPreludeMode,
  AgentSessionLoadOptions,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { createRepoSessionHydrationService } from "../lifecycle/repo-session-hydration-service";
import { createSessionHydrationOperations } from "../lifecycle/session-hydration-operations";
import type { AgentSessionPresenceStore } from "../lifecycle/session-presence-store";
import {
  deriveAgentSessionViewLifecycle,
  type SessionRepoReadinessState,
} from "../lifecycle/session-view-lifecycle";
import type { UpdateAgentSession } from "./use-agent-session-mutations";

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

type LoadAgentSessions = (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;

type UseRepoSessionHydrationEffectsArgs = {
  workspaceRepoPath: string | null;
  tasks: TaskCard[];
  sessionsRef: { current: Record<string, AgentSessionState> };
  currentWorkspaceRepoPathRef: { current: string | null };
  agentSessionPresenceStore: AgentSessionPresenceStore;
  loadAgentSessions: LoadAgentSessions;
  updateSession: UpdateAgentSession;
};

export const useRepoSessionHydrationEffects = ({
  workspaceRepoPath,
  tasks,
  sessionsRef,
  currentWorkspaceRepoPathRef,
  agentSessionPresenceStore,
  loadAgentSessions,
  updateSession,
}: UseRepoSessionHydrationEffectsArgs) => {
  const [sessionRetryTick, setSessionRetryTick] = useState(0);

  const sessionHydration = useMemo(
    () =>
      createSessionHydrationOperations({
        loadAgentSessions,
      }),
    [loadAgentSessions],
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
        await sessionHydration.retrySessionRuntimeAttachment({
          taskId,
          externalSessionId,
          ...(recoveryDedupKey ? { recoveryDedupKey } : {}),
          ...(historyPreludeMode ? { historyPreludeMode } : {}),
          ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
          ...(persistedRecords ? { persistedRecords } : {}),
        });
        attached = hasAttachedRuntime(sessionsRef.current[externalSessionId]);
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

      await sessionHydration.hydrateRequestedTaskSession({
        taskId,
        externalSessionId,
        ...(historyPreludeMode ? { historyPreludeMode } : {}),
        ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
        ...(persistedRecords ? { persistedRecords } : {}),
      });
      return true;
    },
    [sessionHydration, sessionsRef],
  );

  const repoSessionHydrationService = useMemo(
    () =>
      createRepoSessionHydrationService({
        sessionHydration,
        agentSessionPresenceStore,
        onRetryRequested: () => {
          setSessionRetryTick((current) => current + 1);
        },
      }),
    [agentSessionPresenceStore, sessionHydration],
  );

  const isCurrentActiveRepo = useCallback(
    (repoPath: string): boolean => currentWorkspaceRepoPathRef.current === repoPath,
    [currentWorkspaceRepoPathRef],
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

  return {
    agentSessionPresenceStore,
    sessionHydration,
    retrySessionRuntimeAttachment,
    ensureSessionReadyForView,
  };
};
