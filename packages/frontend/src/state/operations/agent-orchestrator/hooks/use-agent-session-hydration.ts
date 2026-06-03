import type { AgentSessionRecord } from "@openducktor/contracts";
import { useCallback, useMemo } from "react";
import type {
  AgentSessionHistoryPreludeMode,
  AgentSessionLoadOptions,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { createSessionHydrationOperations } from "../lifecycle/session-hydration-operations";
import {
  deriveAgentSessionViewLifecycle,
  type SessionRepoReadinessState,
} from "../lifecycle/session-view-lifecycle";
import { requiresHydratedAgentSessionHistory } from "../support/history-hydration";
import type { UpdateAgentSession } from "./use-agent-session-mutations";

type LoadAgentSessions = (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;

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

const shouldAllowLiveResumeForView = (session: AgentSessionState): boolean => {
  return session.status === "running" || session.status === "starting";
};

export const useAgentSessionHydration = ({
  loadAgentSessions,
  sessionsRef,
  updateSession,
}: {
  loadAgentSessions: LoadAgentSessions;
  sessionsRef: { current: Record<string, AgentSessionState> };
  updateSession: UpdateAgentSession;
}) => {
  const sessionHydration = useMemo(
    () => createSessionHydrationOperations({ loadAgentSessions }),
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
      persistedRecords,
    }: {
      taskId: string;
      externalSessionId: string;
      repoReadinessState: SessionRepoReadinessState;
      historyPreludeMode?: AgentSessionHistoryPreludeMode;
      persistedRecords?: AgentSessionRecord[];
    }): Promise<boolean> => {
      const session = sessionsRef.current[externalSessionId] ?? null;
      const lifecycle = deriveAgentSessionViewLifecycle({ session, repoReadinessState });

      if (!session || !lifecycle.shouldEnsureReadyForView) {
        return lifecycle.phase === "ready";
      }

      await sessionHydration.hydrateRequestedTaskSession({
        taskId,
        externalSessionId,
        historyPolicy: requiresHydratedAgentSessionHistory(session) ? "requested_only" : "none",
        allowLiveSessionResume: shouldAllowLiveResumeForView(session),
        ...(historyPreludeMode ? { historyPreludeMode } : {}),
        ...(persistedRecords ? { persistedRecords } : {}),
      });
      return true;
    },
    [sessionHydration, sessionsRef],
  );

  return { sessionHydration, retrySessionRuntimeAttachment, ensureSessionReadyForView };
};
