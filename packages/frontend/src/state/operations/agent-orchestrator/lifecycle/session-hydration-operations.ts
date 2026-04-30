import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import type { LiveAgentSessionSnapshot } from "@openducktor/core";
import type {
  AgentSessionHistoryPreludeMode,
  AgentSessionLoadOptions,
  AgentSessionState,
  RuntimeConnectionPreloadIndex,
} from "@/types/agent-orchestrator";
import {
  getAgentSessionHistoryHydrationState,
  requiresHydratedAgentSessionHistory,
} from "../support/history-hydration";
import { hasAttachedSessionRuntime } from "../support/session-runtime-attachment";

type LoadAgentSessions = (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;

export type SessionHydrationOperations = {
  bootstrapTaskSessions: (taskId: string, persistedRecords?: AgentSessionRecord[]) => Promise<void>;
  hydrateRequestedTaskSession: (input: {
    taskId: string;
    externalSessionId: string;
    historyPreludeMode?: AgentSessionHistoryPreludeMode;
    allowLiveSessionResume?: boolean;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<void>;
  recoverSessionRuntimeAndHydrateRequestedTaskSession: (input: {
    taskId: string;
    externalSessionId: string;
    recoveryDedupKey?: string | null;
    historyPreludeMode?: AgentSessionHistoryPreludeMode;
    allowLiveSessionResume?: boolean;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<boolean>;
  retrySessionRuntimeAttachment: (input: {
    taskId: string;
    externalSessionId: string;
    recoveryDedupKey?: string | null;
    historyPreludeMode?: AgentSessionHistoryPreludeMode;
    allowLiveSessionResume?: boolean;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<void>;
  reconcileLiveTaskSessions: (input: {
    taskId: string;
    persistedRecords?: AgentSessionRecord[];
    preloadedRuntimeLists?: Map<RuntimeKind, RuntimeInstanceSummary[]>;
    preloadedRuntimeConnections?: RuntimeConnectionPreloadIndex;
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
  getSessionSnapshot: (externalSessionId: string) => AgentSessionState | undefined;
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
      externalSessionId,
      historyPreludeMode,
      allowLiveSessionResume,
      persistedRecords,
    }) =>
      loadAgentSessions(
        taskId,
        withPersistedRecords(
          {
            mode: "requested_history",
            targetExternalSessionId: externalSessionId,
            historyPolicy: "requested_only",
            ...(historyPreludeMode ? { historyPreludeMode } : {}),
            ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
          },
          persistedRecords,
        ),
      ),
    recoverSessionRuntimeAndHydrateRequestedTaskSession: async ({
      taskId,
      externalSessionId,
      recoveryDedupKey,
      historyPreludeMode,
      allowLiveSessionResume,
      persistedRecords,
    }) => {
      await loadAgentSessions(
        taskId,
        withPersistedRecords(
          {
            mode: "recover_runtime_attachment",
            targetExternalSessionId: externalSessionId,
            ...(recoveryDedupKey ? { recoveryDedupKey } : {}),
            historyPolicy: "none",
            ...(historyPreludeMode ? { historyPreludeMode } : {}),
            ...(allowLiveSessionResume !== undefined ? { allowLiveSessionResume } : {}),
          },
          persistedRecords,
        ),
      );

      const recoveredSession = getSessionSnapshot(externalSessionId);
      const attached = hasAttachedSessionRuntime(recoveredSession);
      const historyHydrationState = getAgentSessionHistoryHydrationState(recoveredSession);
      const shouldHydrateAfterRecovery =
        recoveredSession !== undefined &&
        attached &&
        requiresHydratedAgentSessionHistory(recoveredSession) &&
        historyHydrationState !== "hydrating";

      if (!shouldHydrateAfterRecovery) {
        return attached;
      }

      await loadAgentSessions(
        taskId,
        withPersistedRecords(
          {
            mode: "requested_history",
            targetExternalSessionId: externalSessionId,
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
      externalSessionId,
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
            targetExternalSessionId: externalSessionId,
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
      preloadedRuntimeConnections,
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
            ...(preloadedRuntimeConnections ? { preloadedRuntimeConnections } : {}),
            ...(preloadedLiveAgentSessionsByKey ? { preloadedLiveAgentSessionsByKey } : {}),
            ...(allowRuntimeEnsure !== undefined ? { allowRuntimeEnsure } : {}),
          },
          persistedRecords,
        ),
      ),
    loadAgentSessions,
  };
};
