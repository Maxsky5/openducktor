import type {
  AgentSessionRecord,
  RunSummary,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import type { AgentRuntimeConnection, LiveAgentSessionSnapshot } from "@openducktor/core";
import type { AgentSessionLoadOptions, AgentSessionState } from "@/types/agent-orchestrator";
import {
  getAgentSessionHistoryHydrationState,
  requiresHydratedAgentSessionHistory,
} from "../support/history-hydration";
import { getSessionMessageCount } from "../support/messages";

type LoadAgentSessions = (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;

export type SessionHydrationOperations = {
  bootstrapTaskSessions: (taskId: string, persistedRecords?: AgentSessionRecord[]) => Promise<void>;
  hydrateRequestedTaskSession: (input: {
    taskId: string;
    sessionId: string;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<void>;
  recoverSessionRuntimeAndHydrateRequestedTaskSession: (input: {
    taskId: string;
    sessionId: string;
    recoveryDedupKey?: string | null;
    persistedRecords?: AgentSessionRecord[];
    preloadedRuns?: RunSummary[];
  }) => Promise<boolean>;
  retrySessionRuntimeAttachment: (input: {
    taskId: string;
    sessionId: string;
    recoveryDedupKey?: string | null;
    persistedRecords?: AgentSessionRecord[];
    preloadedRuns?: RunSummary[];
  }) => Promise<void>;
  reconcileLiveTaskSessions: (input: {
    taskId: string;
    persistedRecords?: AgentSessionRecord[];
    preloadedRuns?: RunSummary[];
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
    hydrateRequestedTaskSession: ({ taskId, sessionId, persistedRecords }) =>
      loadAgentSessions(
        taskId,
        withPersistedRecords(
          {
            mode: "requested_history",
            targetSessionId: sessionId,
            historyPolicy: "requested_only",
          },
          persistedRecords,
        ),
      ),
    recoverSessionRuntimeAndHydrateRequestedTaskSession: async ({
      taskId,
      sessionId,
      recoveryDedupKey,
      persistedRecords,
      preloadedRuns,
    }) => {
      await loadAgentSessions(
        taskId,
        withPersistedRecords(
          {
            mode: "recover_runtime_attachment",
            targetSessionId: sessionId,
            ...(recoveryDedupKey ? { recoveryDedupKey } : {}),
            ...(preloadedRuns ? { preloadedRuns } : {}),
            historyPolicy: "none",
          },
          persistedRecords,
        ),
      );

      const recoveredSession = getSessionSnapshot(sessionId);
      const attached = Boolean(recoveredSession?.runtimeRoute || recoveredSession?.runtimeId);
      const historyHydrationState = getAgentSessionHistoryHydrationState(recoveredSession);
      const shouldHydrateAfterRecovery =
        recoveredSession !== undefined &&
        attached &&
        requiresHydratedAgentSessionHistory(recoveredSession) &&
        historyHydrationState !== "hydrating" &&
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
          },
          persistedRecords,
        ),
      );

      return true;
    },
    retrySessionRuntimeAttachment: ({
      taskId,
      sessionId,
      recoveryDedupKey,
      persistedRecords,
      preloadedRuns,
    }) =>
      loadAgentSessions(
        taskId,
        withPersistedRecords(
          {
            mode: "recover_runtime_attachment",
            targetSessionId: sessionId,
            ...(recoveryDedupKey ? { recoveryDedupKey } : {}),
            ...(preloadedRuns ? { preloadedRuns } : {}),
            historyPolicy: "none",
          },
          persistedRecords,
        ),
      ),
    reconcileLiveTaskSessions: ({
      taskId,
      persistedRecords,
      preloadedRuns,
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
            ...(preloadedRuns ? { preloadedRuns } : {}),
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
