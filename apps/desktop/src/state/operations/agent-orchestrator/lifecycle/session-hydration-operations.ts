import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import type { AgentRuntimeConnection, LiveAgentSessionSnapshot } from "@openducktor/core";
import type {
  AgentSessionHistoryPreludeMode,
  AgentSessionLoadOptions,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import {
  getAgentSessionHistoryHydrationState,
  requiresHydratedAgentSessionHistory,
} from "../support/history-hydration";
import { getSessionMessageCount } from "../support/messages";
import { hasAttachedSessionRuntime } from "../support/session-runtime-attachment";

type LoadAgentSessions = (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;

export type SessionHydrationOperations = {
  bootstrapTaskSessions: (taskId: string, persistedRecords?: AgentSessionRecord[]) => Promise<void>;
  hydrateRequestedTaskSession: (input: {
    taskId: string;
    sessionId: string;
    historyPreludeMode?: AgentSessionHistoryPreludeMode;
    allowLiveSessionResume?: boolean;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<void>;
  recoverSessionRuntimeAndHydrateRequestedTaskSession: (input: {
    taskId: string;
    sessionId: string;
    recoveryDedupKey?: string | null;
    historyPreludeMode?: AgentSessionHistoryPreludeMode;
    allowLiveSessionResume?: boolean;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<boolean>;
  retrySessionRuntimeAttachment: (input: {
    taskId: string;
    sessionId: string;
    recoveryDedupKey?: string | null;
    historyPreludeMode?: AgentSessionHistoryPreludeMode;
    allowLiveSessionResume?: boolean;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<void>;
  reconcileLiveTaskSessions: (input: {
    taskId: string;
    persistedRecords?: AgentSessionRecord[];
    preloadedRuntimeLists?: Map<RuntimeKind, RuntimeInstanceSummary[]>;
    preloadedRuntimeConnectionsByKey?: Map<string, AgentRuntimeConnection>;
    preloadedLiveAgentSessionsByKey?: Map<string, LiveAgentSessionSnapshot[]>;
    allowRuntimeEnsure?: boolean;
  }) => Promise<void>;
  loadAgentSessions: LoadAgentSessions;
};

export const createSessionHydrationOperations = ({
  loadAgentSessions,
  getSessionSnapshot,
}: {
  loadAgentSessions: LoadAgentSessions;
  getSessionSnapshot: (sessionId: string) => AgentSessionState | undefined;
}): SessionHydrationOperations => {
  const withPersistedRecords = (
    options: AgentSessionLoadOptions,
    persistedRecords?: AgentSessionRecord[],
  ): AgentSessionLoadOptions => (persistedRecords ? { ...options, persistedRecords } : options);

  return {
    bootstrapTaskSessions: (taskId, persistedRecords) =>
      loadAgentSessions(taskId, withPersistedRecords({}, persistedRecords)),
    hydrateRequestedTaskSession: ({
      taskId,
      sessionId,
      historyPreludeMode,
      allowLiveSessionResume,
      persistedRecords,
    }) =>
      loadAgentSessions(
        taskId,
        withPersistedRecords(
          {
            mode: "requested_history",
            targetSessionId: sessionId,
            historyPolicy: "requested_only",
            ...(historyPreludeMode ? { historyPreludeMode } : {}),
            ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
          },
          persistedRecords,
        ),
      ),
    recoverSessionRuntimeAndHydrateRequestedTaskSession: async ({
      taskId,
      sessionId,
      recoveryDedupKey,
      historyPreludeMode,
      allowLiveSessionResume,
      persistedRecords,
    }) => {
      const sessionBeforeRecovery = getSessionSnapshot(sessionId);
      const hadLocalTranscriptBeforeRecovery =
        sessionBeforeRecovery !== undefined && getSessionMessageCount(sessionBeforeRecovery) > 0;

      await loadAgentSessions(
        taskId,
        withPersistedRecords(
          {
            mode: "recover_runtime_attachment",
            targetSessionId: sessionId,
            ...(recoveryDedupKey ? { recoveryDedupKey } : {}),
            historyPolicy: "none",
            ...(historyPreludeMode ? { historyPreludeMode } : {}),
            ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
          },
          persistedRecords,
        ),
      );

      const recoveredSession = getSessionSnapshot(sessionId);
      const attached = hasAttachedSessionRuntime(recoveredSession);
      const historyHydrationState = getAgentSessionHistoryHydrationState(recoveredSession);
      const shouldHydrateAfterRecovery =
        recoveredSession !== undefined &&
        attached &&
        requiresHydratedAgentSessionHistory(recoveredSession) &&
        historyHydrationState !== "hydrating" &&
        !hadLocalTranscriptBeforeRecovery &&
        getSessionMessageCount(recoveredSession) === 0;

      if (!shouldHydrateAfterRecovery) {
        return attached;
      }

      await loadAgentSessions(
        taskId,
        withPersistedRecords(
          {
            mode: "requested_history",
            targetSessionId: sessionId,
            historyPolicy: "requested_only",
            ...(historyPreludeMode ? { historyPreludeMode } : {}),
            ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
          },
          persistedRecords,
        ),
      );

      return attached;
    },
    retrySessionRuntimeAttachment: ({
      taskId,
      sessionId,
      recoveryDedupKey,
      historyPreludeMode,
      allowLiveSessionResume,
      persistedRecords,
    }) =>
      loadAgentSessions(
        taskId,
        withPersistedRecords(
          {
            mode: "recover_runtime_attachment",
            targetSessionId: sessionId,
            ...(recoveryDedupKey ? { recoveryDedupKey } : {}),
            historyPolicy: "none",
            ...(historyPreludeMode ? { historyPreludeMode } : {}),
            ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
          },
          persistedRecords,
        ),
      ),
    reconcileLiveTaskSessions: ({
      taskId,
      persistedRecords,
      preloadedRuntimeLists,
      preloadedRuntimeConnectionsByKey,
      preloadedLiveAgentSessionsByKey,
      allowRuntimeEnsure,
    }) =>
      loadAgentSessions(
        taskId,
        withPersistedRecords(
          {
            mode: "reconcile_live",
            historyPolicy: "none",
            ...(preloadedRuntimeLists ? { preloadedRuntimeLists } : {}),
            ...(preloadedRuntimeConnectionsByKey ? { preloadedRuntimeConnectionsByKey } : {}),
            ...(preloadedLiveAgentSessionsByKey ? { preloadedLiveAgentSessionsByKey } : {}),
            ...(allowRuntimeEnsure !== undefined ? { allowRuntimeEnsure } : {}),
          },
          persistedRecords,
        ),
      ),
    loadAgentSessions,
  };
};
