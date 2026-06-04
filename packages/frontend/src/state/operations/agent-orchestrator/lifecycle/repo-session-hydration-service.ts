import type { AgentSessionRecord, RuntimeKind, TaskCard } from "@openducktor/contracts";
import { readPersistedRuntimeKind } from "../support/session-runtime-metadata";
import type { RepoSessionPresencePreloads } from "./repo-session-presence-preloads";
import type { SessionHydrationOperations } from "./session-hydration-operations";

type HydrationScope = "bootstrap" | "reconcile";

const nextSessionRetryDelayMs = (attempt: number): number => Math.min(5_000, 500 * 2 ** attempt);

const getTaskRecords = (task: TaskCard): AgentSessionRecord[] => task.agentSessions ?? [];

type TaskSessionRecordEntry = {
  task: TaskCard;
  records: AgentSessionRecord[];
  recordKey: string;
};

const areRecordRuntimesReady = (
  records: AgentSessionRecord[],
  isRuntimeReady: (runtimeKind: RuntimeKind) => boolean,
): boolean => {
  return records.every((record) => isRuntimeReady(readPersistedRuntimeKind(record)));
};

const toTaskRecordKey = (taskId: string, records: AgentSessionRecord[]): string => {
  const recordKeys = records
    .map(
      (record) =>
        `${record.externalSessionId}::${record.runtimeKind}::${record.workingDirectory}::${record.startedAt}`,
    )
    .sort();
  return `${taskId}::${recordKeys.join("|")}`;
};

export const createRepoSessionHydrationService = ({
  initialRepoPath,
  sessionHydration,
  prepareRepoSessionPresencePreloads,
  onRetryRequested,
}: {
  initialRepoPath?: string | null;
  sessionHydration: Pick<
    SessionHydrationOperations,
    "bootstrapTaskSessions" | "reconcileLiveTaskSessions"
  >;
  prepareRepoSessionPresencePreloads?: (input: {
    repoPath: string;
    records: AgentSessionRecord[];
  }) => Promise<RepoSessionPresencePreloads>;
  onRetryRequested: () => void;
}) => {
  const bootstrappedSessionRecordKeysByRepo: Record<string, Set<string>> = {};
  const reconciledRecordKeysByRepo: Record<string, Set<string>> = {};
  const inFlightReconcileTasksByRepo: Record<string, Set<string>> = {};
  const retryAttemptsByKey: Record<string, number> = {};
  const retryTimeoutsByKey: Record<string, ReturnType<typeof setTimeout>> = {};
  const getOrCreateRepoSet = (
    store: Record<string, Set<string>>,
    repoPath: string,
  ): Set<string> => {
    const existing = store[repoPath];
    if (existing) {
      return existing;
    }
    const created = new Set<string>();
    store[repoPath] = created;
    return created;
  };
  const initializeRepoScope = (repoPath: string): void => {
    getOrCreateRepoSet(bootstrappedSessionRecordKeysByRepo, repoPath);
    getOrCreateRepoSet(reconciledRecordKeysByRepo, repoPath);
    getOrCreateRepoSet(inFlightReconcileTasksByRepo, repoPath);
  };

  if (initialRepoPath) {
    initializeRepoScope(initialRepoPath);
  }

  const toTaskSessionRecordEntries = (tasks: TaskCard[]): TaskSessionRecordEntry[] => {
    const entries: TaskSessionRecordEntry[] = [];
    for (const task of tasks) {
      const records = getTaskRecords(task);
      if (records.length === 0) {
        continue;
      }
      entries.push({
        task,
        records,
        recordKey: toTaskRecordKey(task.id, records),
      });
    }
    return entries;
  };

  const clearRetry = (scope: HydrationScope, repoPath: string, taskId: string): void => {
    const retryKey = `${scope}::${repoPath}::${taskId}`;
    const timeout = retryTimeoutsByKey[retryKey];
    if (timeout !== undefined) {
      clearTimeout(timeout);
      delete retryTimeoutsByKey[retryKey];
    }
    delete retryAttemptsByKey[retryKey];
  };

  const scheduleRetry = (
    scope: HydrationScope,
    repoPath: string,
    taskId: string,
    error: unknown,
  ): void => {
    const retryKey = `${scope}::${repoPath}::${taskId}`;
    if (retryTimeoutsByKey[retryKey] !== undefined) {
      return;
    }
    const attempt = retryAttemptsByKey[retryKey] ?? 0;
    retryAttemptsByKey[retryKey] = attempt + 1;
    const delayMs = nextSessionRetryDelayMs(attempt);
    console.error(
      `Failed to ${scope} agent sessions for task '${taskId}' in repo '${repoPath}'. Retrying in ${delayMs}ms.`,
      error,
    );
    retryTimeoutsByKey[retryKey] = setTimeout(() => {
      delete retryTimeoutsByKey[retryKey];
      onRetryRequested();
    }, delayMs);
  };

  const bootstrapTaskSessionRecords = async ({
    repoPath,
    entries,
    isCurrentRepo,
  }: {
    repoPath: string;
    entries: TaskSessionRecordEntry[];
    isCurrentRepo: (repoPath: string) => boolean;
  }): Promise<void> => {
    const bootstrappedSessionRecordKeys = getOrCreateRepoSet(
      bootstrappedSessionRecordKeysByRepo,
      repoPath,
    );
    const pendingEntries: TaskSessionRecordEntry[] = [];
    for (const entry of entries) {
      if (bootstrappedSessionRecordKeys.has(entry.recordKey)) {
        continue;
      }
      bootstrappedSessionRecordKeys.add(entry.recordKey);
      pendingEntries.push(entry);
    }

    if (!isCurrentRepo(repoPath)) {
      for (const entry of pendingEntries) {
        bootstrappedSessionRecordKeys.delete(entry.recordKey);
      }
      return;
    }
    if (pendingEntries.length === 0) {
      return;
    }
    const results = await Promise.allSettled(
      pendingEntries.map(async (entry) => {
        await sessionHydration.bootstrapTaskSessions(entry.task.id, entry.records);
        return entry.task.id;
      }),
    );
    if (isCurrentRepo(repoPath)) {
      for (const [index, result] of results.entries()) {
        const entry = pendingEntries[index];
        if (!entry) {
          continue;
        }
        if (result.status === "fulfilled") {
          clearRetry("bootstrap", repoPath, result.value);
          continue;
        }
        bootstrappedSessionRecordKeys.delete(entry.recordKey);
        scheduleRetry("bootstrap", repoPath, entry.task.id, result.reason);
      }
    } else {
      for (const entry of pendingEntries) {
        bootstrappedSessionRecordKeys.delete(entry.recordKey);
      }
    }
  };

  return {
    resetRepo(repoPath: string): void {
      getOrCreateRepoSet(bootstrappedSessionRecordKeysByRepo, repoPath).clear();
      getOrCreateRepoSet(reconciledRecordKeysByRepo, repoPath).clear();
      getOrCreateRepoSet(inFlightReconcileTasksByRepo, repoPath).clear();
    },

    dispose(): void {
      for (const timeout of Object.values(retryTimeoutsByKey)) {
        clearTimeout(timeout);
      }
      for (const key of Object.keys(retryTimeoutsByKey)) {
        delete retryTimeoutsByKey[key];
      }
      for (const key of Object.keys(retryAttemptsByKey)) {
        delete retryAttemptsByKey[key];
      }
    },

    async bootstrapPersistedTaskSessions({
      repoPath,
      tasks,
      isCurrentRepo,
    }: {
      repoPath: string;
      tasks: TaskCard[];
      isCurrentRepo: (repoPath: string) => boolean;
    }): Promise<void> {
      await bootstrapTaskSessionRecords({
        repoPath,
        entries: toTaskSessionRecordEntries(tasks),
        isCurrentRepo,
      });
    },

    async reconcilePendingTasks({
      repoPath,
      tasks,
      isCancelled,
      isCurrentRepo,
      isRuntimeReady,
    }: {
      repoPath: string;
      tasks: TaskCard[];
      isCancelled: () => boolean;
      isCurrentRepo: (repoPath: string) => boolean;
      isRuntimeReady: (runtimeKind: RuntimeKind) => boolean;
    }): Promise<void> {
      const inFlight = getOrCreateRepoSet(inFlightReconcileTasksByRepo, repoPath);
      const reconciledRecordKeys = getOrCreateRepoSet(reconciledRecordKeysByRepo, repoPath);
      const pendingTaskEntries: TaskSessionRecordEntry[] = [];
      for (const entry of toTaskSessionRecordEntries(tasks)) {
        const { task, records, recordKey } = entry;
        if (inFlight.has(task.id) || reconciledRecordKeys.has(recordKey)) {
          continue;
        }
        try {
          if (!areRecordRuntimesReady(records, isRuntimeReady)) {
            continue;
          }
        } catch (error) {
          scheduleRetry("reconcile", repoPath, task.id, error);
          continue;
        }
        pendingTaskEntries.push(entry);
      }
      for (const entry of pendingTaskEntries) {
        inFlight.add(entry.task.id);
      }
      try {
        if (pendingTaskEntries.length === 0) {
          return;
        }
        let preloads: RepoSessionPresencePreloads | null = null;
        if (prepareRepoSessionPresencePreloads) {
          try {
            preloads = await prepareRepoSessionPresencePreloads({
              repoPath,
              records: pendingTaskEntries.flatMap((entry) => entry.records),
            });
          } catch (error) {
            if (isCancelled() || !isCurrentRepo(repoPath)) {
              return;
            }
            // Preload failure can still materialize durable sessions, but live reconciliation must
            // retry later; marking these record keys reconciled here would suppress that retry.
            await bootstrapTaskSessionRecords({
              repoPath,
              entries: pendingTaskEntries,
              isCurrentRepo,
            });
            for (const entry of pendingTaskEntries) {
              scheduleRetry("reconcile", repoPath, entry.task.id, error);
            }
            return;
          }
          if (isCancelled() || !isCurrentRepo(repoPath)) {
            return;
          }
        }

        const results = await Promise.allSettled(
          pendingTaskEntries.map(async ({ task, records, recordKey }) => {
            await sessionHydration.reconcileLiveTaskSessions({
              taskId: task.id,
              persistedRecords: records,
              ...(preloads
                ? {
                    preloadedSessionPresenceByKey: preloads.preloadedSessionPresenceByKey,
                  }
                : {}),
            });
            return { taskId: task.id, recordKey };
          }),
        );
        if (isCancelled() || !isCurrentRepo(repoPath)) {
          return;
        }
        for (const [index, result] of results.entries()) {
          const entry = pendingTaskEntries[index];
          if (!entry) {
            continue;
          }
          if (result.status === "fulfilled") {
            reconciledRecordKeys.add(result.value.recordKey);
            clearRetry("reconcile", repoPath, result.value.taskId);
            continue;
          }
          scheduleRetry("reconcile", repoPath, entry.task.id, result.reason);
        }
      } finally {
        for (const entry of pendingTaskEntries) {
          inFlight.delete(entry.task.id);
        }
      }
    },
  };
};
