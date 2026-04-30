import type { AgentSessionRecord, RuntimeKind, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { host } from "../../shared/host";
import type { LiveAgentSessionStore } from "./live-agent-session-store";
import type { SessionHydrationOperations } from "./session-hydration-operations";

type HydrationScope = "bootstrap" | "reconcile";

const nextSessionRetryDelayMs = (attempt: number): number => Math.min(5_000, 500 * 2 ** attempt);

const getTaskRecords = (task: TaskCard): AgentSessionRecord[] => task.agentSessions ?? [];

export const createRepoSessionHydrationService = ({
  sessionHydration,
  liveAgentSessionStore,
  onRetryRequested,
}: {
  agentEngine: Pick<AgentEnginePort, "listLiveAgentSessionSnapshots">;
  sessionHydration: Pick<
    SessionHydrationOperations,
    "bootstrapTaskSessions" | "reconcileLiveTaskSessions"
  >;
  liveAgentSessionStore: LiveAgentSessionStore;
  onRetryRequested: () => void;
  queryClient?: QueryClient;
  runtimeEnsure?: (
    nextRepoPath: string,
    nextRuntimeKind: RuntimeKind,
  ) => ReturnType<typeof host.runtimeEnsure>;
}) => {
  const bootstrappedTasksByRepo: Record<string, Set<string>> = {};
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

  return {
    resetRepo(repoPath: string): void {
      liveAgentSessionStore.clearRepo(repoPath);
      getOrCreateRepoSet(bootstrappedTasksByRepo, repoPath).clear();
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

    async bootstrapPendingTasks({
      repoPath,
      tasks,
      isCancelled,
      isCurrentRepo,
    }: {
      repoPath: string;
      tasks: TaskCard[];
      isCancelled: () => boolean;
      isCurrentRepo: (repoPath: string) => boolean;
    }): Promise<void> {
      const bootstrappedTasks = getOrCreateRepoSet(bootstrappedTasksByRepo, repoPath);
      const pendingTasks = tasks.filter((task) => !bootstrappedTasks.has(task.id));
      for (const task of pendingTasks) {
        bootstrappedTasks.add(task.id);
      }

      const results = await Promise.allSettled(
        pendingTasks.map(async (task) => {
          await sessionHydration.bootstrapTaskSessions(task.id, getTaskRecords(task));
          return task.id;
        }),
      );
      if (isCancelled() || !isCurrentRepo(repoPath)) {
        return;
      }
      for (const [index, result] of results.entries()) {
        const taskId = pendingTasks[index]?.id;
        if (!taskId) {
          continue;
        }
        if (result.status === "fulfilled") {
          clearRetry("bootstrap", repoPath, taskId);
          continue;
        }
        bootstrappedTasks.delete(taskId);
        scheduleRetry("bootstrap", repoPath, taskId, result.reason);
      }
    },

    async reconcilePendingTasks({
      repoPath,
      tasks,
      isCancelled,
      isCurrentRepo,
    }: {
      repoPath: string;
      tasks: TaskCard[];
      isCancelled: () => boolean;
      isCurrentRepo: (repoPath: string) => boolean;
    }): Promise<void> {
      const inFlight = getOrCreateRepoSet(inFlightReconcileTasksByRepo, repoPath);
      const pendingTasks = tasks.filter(
        (task) => !inFlight.has(task.id) && getTaskRecords(task).length > 0,
      );
      for (const task of pendingTasks) {
        inFlight.add(task.id);
      }
      try {
        const results = await Promise.allSettled(
          pendingTasks.map(async (task) => {
            await sessionHydration.reconcileLiveTaskSessions({
              taskId: task.id,
              persistedRecords: getTaskRecords(task),
            });
            return task.id;
          }),
        );
        if (isCancelled() || !isCurrentRepo(repoPath)) {
          return;
        }
        for (const [index, result] of results.entries()) {
          const taskId = pendingTasks[index]?.id;
          if (!taskId) {
            continue;
          }
          if (result.status === "fulfilled") {
            clearRetry("reconcile", repoPath, taskId);
            continue;
          }
          scheduleRetry("reconcile", repoPath, taskId, result.reason);
        }
      } finally {
        for (const task of pendingTasks) {
          inFlight.delete(task.id);
        }
      }
    },
  };
};
