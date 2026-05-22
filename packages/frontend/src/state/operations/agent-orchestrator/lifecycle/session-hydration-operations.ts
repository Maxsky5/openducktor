import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import type { AgentSessionPresenceSnapshot } from "@openducktor/core";
import type {
  AgentSessionHistoryHydrationPolicy,
  AgentSessionHistoryPreludeMode,
  AgentSessionLoadOptions,
} from "@/types/agent-orchestrator";

type LoadAgentSessions = (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;

export type SessionHydrationOperations = {
  bootstrapTaskSessions: (taskId: string, persistedRecords?: AgentSessionRecord[]) => Promise<void>;
  hydrateRequestedTaskSession: (input: {
    taskId: string;
    externalSessionId: string;
    historyPolicy?: AgentSessionHistoryHydrationPolicy;
    historyPreludeMode?: AgentSessionHistoryPreludeMode;
    allowLiveSessionResume?: boolean;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<void>;
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
    preloadedSessionPresenceByKey?: Map<string, AgentSessionPresenceSnapshot[]>;
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
    hydrateRequestedTaskSession: ({
      taskId,
      externalSessionId,
      historyPolicy,
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
            historyPolicy: historyPolicy ?? "requested_only",
            ...(historyPreludeMode ? { historyPreludeMode } : {}),
            allowLiveSessionResume: allowLiveSessionResume ?? false,
          },
          persistedRecords,
        ),
      ),
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
      preloadedSessionPresenceByKey,
    }) =>
      loadAgentSessions(
        taskId,
        withPersistedRecords(
          {
            mode: "reconcile_live",
            historyPolicy: "none",
            ...(preloadedRuntimeLists ? { preloadedRuntimeLists } : {}),
            ...(preloadedSessionPresenceByKey ? { preloadedSessionPresenceByKey } : {}),
          },
          persistedRecords,
        ),
      ),
    loadAgentSessions,
  };
};
