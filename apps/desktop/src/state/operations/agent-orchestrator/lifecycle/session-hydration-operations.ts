import type {
  AgentSessionRecord,
  RunSummary,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import type { AgentRuntimeConnection, LiveAgentSessionSnapshot } from "@openducktor/core";
import type { AgentSessionLoadOptions } from "@/types/agent-orchestrator";

type LoadAgentSessions = (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;

export type SessionHydrationOperations = {
  bootstrapTaskSessions: (taskId: string, persistedRecords?: AgentSessionRecord[]) => Promise<void>;
  hydrateRequestedTaskSession: (input: {
    taskId: string;
    sessionId: string;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<void>;
  recoverSessionRuntimeAttachment: (input: {
    taskId: string;
    sessionId: string;
    recoveryDedupKey?: string | null;
    persistedRecords?: AgentSessionRecord[];
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
}: {
  loadAgentSessions: LoadAgentSessions;
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
    recoverSessionRuntimeAttachment: ({ taskId, sessionId, recoveryDedupKey, persistedRecords }) =>
      loadAgentSessions(
        taskId,
        withPersistedRecords(
          {
            mode: "recover_runtime_attachment",
            targetSessionId: sessionId,
            ...(recoveryDedupKey ? { recoveryDedupKey } : {}),
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
