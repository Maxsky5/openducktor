import type {
  AgentSessionRecord,
  RuntimeInstanceSummary,
  RuntimeKind,
  TaskCard,
} from "@openducktor/contracts";
import type {
  AgentEnginePort,
  AgentRuntimeConnection,
  LiveAgentSessionSnapshot,
} from "@openducktor/core";
import { appQueryClient } from "@/lib/query-client";
import { loadRuntimeListFromQuery, runtimeQueryKeys } from "@/state/queries/runtime";
import { host } from "../../shared/host";
import { ensureRuntimeAndInvalidateReadinessQueries } from "../../shared/runtime-readiness-publication";
import { resolveRuntimeRouteConnection } from "../runtime/runtime";
import { normalizeWorkingDirectory } from "../support/core";
import {
  isSessionRuntimeMetadataError,
  readPersistedRuntimeKind,
} from "../support/session-runtime-metadata";
import { canUseRepoRootWorkspaceRuntimeForHydration } from "./hydration-runtime-policy";
import {
  getLiveAgentSessionCacheKey,
  LiveAgentSessionCache,
  liveAgentSessionLookupKey,
  runtimeWorkingDirectoryKey,
} from "./live-agent-session-cache";
import type { LiveAgentSessionStore } from "./live-agent-session-store";
import type { SessionHydrationOperations } from "./session-hydration-operations";

type HydrationScope = "bootstrap" | "reconcile";

type RuntimeConnectionScan = {
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
  directories: Set<string>;
};

type ReconcilePreloadPlan = {
  persistedByTask: Array<{ taskId: string; records: AgentSessionRecord[] }>;
  taskIdsToReconcile: Set<string>;
  preloadedRuntimeLists: Map<RuntimeKind, RuntimeInstanceSummary[]>;
  preloadedRuntimeConnectionsByKey: Map<string, AgentRuntimeConnection>;
  preloadedLiveAgentSessionsByKey: Map<string, LiveAgentSessionSnapshot[]>;
  skippedTaskErrors: Map<string, unknown>;
};

type ReconcilePreloadMetadata = {
  persistedByTask: Array<{ taskId: string; records: AgentSessionRecord[] }>;
  persistedTaskIdsByLiveSessionKey: Map<string, Set<string>>;
  runtimeKinds: Set<RuntimeKind>;
  desiredDirectoriesByRuntimeKind: Map<RuntimeKind, Set<string>>;
  runtimeKindsAllowedToEnsureRepoRoot: Set<RuntimeKind>;
  skippedTaskErrors: Map<string, unknown>;
};

const nextSessionRetryDelayMs = (attempt: number): number => Math.min(5_000, 500 * 2 ** attempt);

const invalidateRuntimeList = async (runtimeKind: RuntimeKind, repoPath: string): Promise<void> => {
  await appQueryClient.invalidateQueries({
    queryKey: runtimeQueryKeys.list(runtimeKind, repoPath),
    exact: true,
    refetchType: "none",
  });
};

const getOrCreateRepoTaskSet = (
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

const getOrCreateMapSet = <K>(map: Map<K, Set<string>>, key: K): Set<string> => {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }

  const created = new Set<string>();
  map.set(key, created);
  return created;
};

const collectReconcilePreloadMetadata = ({
  tasks,
  repoPath,
}: {
  tasks: TaskCard[];
  repoPath: string;
}): ReconcilePreloadMetadata => {
  const persistedByTask = tasks.map((task) => ({
    taskId: task.id,
    records: task.agentSessions ?? [],
  }));

  const persistedTaskIdsByLiveSessionKey = new Map<string, Set<string>>();
  const runtimeKinds = new Set<RuntimeKind>();
  const desiredDirectoriesByRuntimeKind = new Map<RuntimeKind, Set<string>>();
  const runtimeKindsAllowedToEnsureRepoRoot = new Set<RuntimeKind>();
  const skippedTaskErrors = new Map<string, unknown>();

  for (const { taskId, records } of persistedByTask) {
    const taskRuntimeKinds = new Set<RuntimeKind>();
    const taskLiveSessionKeys = new Set<string>();
    const taskDesiredDirectoriesByRuntimeKind = new Map<RuntimeKind, Set<string>>();
    const taskRuntimeKindsAllowedToEnsureRepoRoot = new Set<RuntimeKind>();

    try {
      for (const record of records) {
        const runtimeKind = readPersistedRuntimeKind(record);
        const externalSessionId = record.externalSessionId ?? record.sessionId;
        if (!externalSessionId) {
          continue;
        }

        taskRuntimeKinds.add(runtimeKind);
        taskLiveSessionKeys.add(`${runtimeKind}::${externalSessionId}`);
        getOrCreateMapSet(taskDesiredDirectoriesByRuntimeKind, runtimeKind).add(
          normalizeWorkingDirectory(record.workingDirectory),
        );
        if (canUseRepoRootWorkspaceRuntimeForHydration(record, repoPath)) {
          taskRuntimeKindsAllowedToEnsureRepoRoot.add(runtimeKind);
        }
      }
    } catch (error) {
      if (!isSessionRuntimeMetadataError(error)) {
        throw error;
      }

      console.error(
        `Skipping reconcile preload for task '${taskId}' in repo '${repoPath}' because persisted session runtime metadata is invalid.`,
        error,
      );
      skippedTaskErrors.set(taskId, error);
      continue;
    }

    for (const runtimeKind of taskRuntimeKinds) {
      runtimeKinds.add(runtimeKind);
    }

    for (const liveSessionKey of taskLiveSessionKeys) {
      getOrCreateMapSet(persistedTaskIdsByLiveSessionKey, liveSessionKey).add(taskId);
    }

    for (const [runtimeKind, workingDirectories] of taskDesiredDirectoriesByRuntimeKind) {
      const desiredDirectories = getOrCreateMapSet(desiredDirectoriesByRuntimeKind, runtimeKind);
      for (const workingDirectory of workingDirectories) {
        desiredDirectories.add(workingDirectory);
      }
    }

    for (const runtimeKind of taskRuntimeKindsAllowedToEnsureRepoRoot) {
      runtimeKindsAllowedToEnsureRepoRoot.add(runtimeKind);
    }
  }

  return {
    persistedByTask,
    persistedTaskIdsByLiveSessionKey,
    runtimeKinds,
    desiredDirectoriesByRuntimeKind,
    runtimeKindsAllowedToEnsureRepoRoot,
    skippedTaskErrors,
  };
};

export const createRepoSessionHydrationService = ({
  agentEngine,
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
}) => {
  const bootstrappedTasksByRepo: Record<string, Set<string>> = {};
  const reconciledTasksByRepo: Record<string, Set<string>> = {};
  const retryAttemptsByKey: Record<string, number> = {};
  const retryTimeoutsByKey: Record<string, ReturnType<typeof setTimeout>> = {};

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

  const buildReconcilePreloadPlan = async ({
    repoPath,
    tasks,
    isCancelled,
  }: {
    repoPath: string;
    tasks: TaskCard[];
    isCancelled: () => boolean;
  }): Promise<ReconcilePreloadPlan> => {
    const {
      persistedByTask,
      persistedTaskIdsByLiveSessionKey,
      runtimeKinds,
      desiredDirectoriesByRuntimeKind,
      runtimeKindsAllowedToEnsureRepoRoot,
      skippedTaskErrors,
    } = collectReconcilePreloadMetadata({ tasks, repoPath });

    const runtimeConnections = new Map<string, RuntimeConnectionScan>();
    const preloadedRuntimeLists = new Map<RuntimeKind, RuntimeInstanceSummary[]>();
    const preloadedRuntimeConnectionsByKey = new Map<string, AgentRuntimeConnection>();
    for (const runtimeKind of runtimeKinds) {
      const runtimes = await loadRuntimeListFromQuery(appQueryClient, runtimeKind, repoPath);
      if (isCancelled()) {
        return {
          persistedByTask,
          taskIdsToReconcile: new Set<string>(),
          preloadedRuntimeLists,
          preloadedRuntimeConnectionsByKey,
          preloadedLiveAgentSessionsByKey: new Map<string, LiveAgentSessionSnapshot[]>(),
          skippedTaskErrors,
        };
      }

      const runtimeEntries = [...runtimes];
      const desiredDirectories = desiredDirectoriesByRuntimeKind.get(runtimeKind) ?? new Set();
      const repoPathKey = normalizeWorkingDirectory(repoPath);
      const needsRepoRootRuntime =
        runtimeKindsAllowedToEnsureRepoRoot.has(runtimeKind) &&
        !runtimeEntries.some(
          (runtime) => normalizeWorkingDirectory(runtime.workingDirectory) === repoPathKey,
        );
      if (needsRepoRootRuntime) {
        const ensuredRuntime = await ensureRuntimeAndInvalidateReadinessQueries({
          repoPath,
          runtimeKind,
          ensureRuntime: (nextRepoPath, nextRuntimeKind) =>
            host.runtimeEnsure(nextRepoPath, nextRuntimeKind),
        });
        await invalidateRuntimeList(runtimeKind, repoPath);
        if (isCancelled()) {
          return {
            persistedByTask,
            taskIdsToReconcile: new Set<string>(),
            preloadedRuntimeLists,
            preloadedRuntimeConnectionsByKey,
            preloadedLiveAgentSessionsByKey: new Map<string, LiveAgentSessionSnapshot[]>(),
            skippedTaskErrors,
          };
        }
        runtimeEntries.push(ensuredRuntime);
      }

      preloadedRuntimeLists.set(runtimeKind, runtimeEntries);

      for (const runtime of runtimeEntries) {
        const { runtimeConnection } = resolveRuntimeRouteConnection(
          runtime.runtimeRoute,
          runtime.workingDirectory,
        );
        preloadedRuntimeConnectionsByKey.set(
          runtimeWorkingDirectoryKey(runtimeKind, runtime.workingDirectory),
          runtimeConnection,
        );
        if (!desiredDirectories.has(normalizeWorkingDirectory(runtime.workingDirectory))) {
          continue;
        }

        const scanKey = getLiveAgentSessionCacheKey(runtimeKind, runtimeConnection);
        if (!runtimeConnections.has(scanKey)) {
          runtimeConnections.set(scanKey, {
            runtimeKind,
            runtimeConnection,
            directories: new Set<string>(),
          });
        }
        runtimeConnections.get(scanKey)?.directories.add(runtime.workingDirectory);
      }
    }

    const taskIdsToReconcile = new Set<string>();
    const preloadedLiveAgentSessionsByKey = new Map<string, LiveAgentSessionSnapshot[]>();
    const runtimeSessionScanCache = new LiveAgentSessionCache(agentEngine);

    for (const input of runtimeConnections.values()) {
      const runtimeSessions = await runtimeSessionScanCache.load({
        runtimeKind: input.runtimeKind,
        runtimeConnection: input.runtimeConnection,
        directories: Array.from(input.directories),
      });
      if (isCancelled()) {
        return {
          persistedByTask,
          taskIdsToReconcile: new Set<string>(),
          preloadedRuntimeLists,
          preloadedRuntimeConnectionsByKey,
          preloadedLiveAgentSessionsByKey,
          skippedTaskErrors,
        };
      }

      const sessionsByWorkingDirectory = new Map<string, LiveAgentSessionSnapshot[]>();
      for (const runtimeSession of runtimeSessions) {
        const workingDirectoryKey = normalizeWorkingDirectory(runtimeSession.workingDirectory);
        const sessionsForDirectory = sessionsByWorkingDirectory.get(workingDirectoryKey) ?? [];
        sessionsForDirectory.push(runtimeSession);
        sessionsByWorkingDirectory.set(workingDirectoryKey, sessionsForDirectory);
      }

      for (const [workingDirectory, sessionsForDirectory] of sessionsByWorkingDirectory) {
        preloadedLiveAgentSessionsByKey.set(
          liveAgentSessionLookupKey(input.runtimeKind, input.runtimeConnection, workingDirectory),
          sessionsForDirectory,
        );
      }

      for (const runtimeSession of runtimeSessions) {
        const liveSessionKey = `${input.runtimeKind}::${runtimeSession.externalSessionId}`;
        const taskIds = persistedTaskIdsByLiveSessionKey.get(liveSessionKey);
        if (!taskIds) {
          continue;
        }
        for (const taskId of taskIds) {
          taskIdsToReconcile.add(taskId);
        }
      }
    }

    return {
      persistedByTask,
      taskIdsToReconcile,
      preloadedRuntimeLists,
      preloadedRuntimeConnectionsByKey,
      preloadedLiveAgentSessionsByKey,
      skippedTaskErrors,
    };
  };

  return {
    resetRepo(repoPath: string): void {
      liveAgentSessionStore.clearRepo(repoPath);
      getOrCreateRepoTaskSet(bootstrappedTasksByRepo, repoPath);
      getOrCreateRepoTaskSet(reconciledTasksByRepo, repoPath);
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
      const bootstrappedTasks = getOrCreateRepoTaskSet(bootstrappedTasksByRepo, repoPath);
      const pendingTasks = tasks.filter((task) => !bootstrappedTasks.has(task.id));
      if (pendingTasks.length === 0) {
        return;
      }

      for (const task of pendingTasks) {
        bootstrappedTasks.add(task.id);
      }

      try {
        const results = await Promise.allSettled(
          pendingTasks.map(async (task) => {
            await sessionHydration.bootstrapTaskSessions(task.id, task.agentSessions ?? []);
            return task.id;
          }),
        );
        if (isCancelled()) {
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
          if (!isCurrentRepo(repoPath)) {
            return;
          }
          scheduleRetry("bootstrap", repoPath, taskId, result.reason);
          bootstrappedTasksByRepo[repoPath]?.delete(taskId);
        }
      } catch (error) {
        if (isCancelled() || !isCurrentRepo(repoPath)) {
          return;
        }
        for (const task of pendingTasks) {
          scheduleRetry("bootstrap", repoPath, task.id, error);
          bootstrappedTasksByRepo[repoPath]?.delete(task.id);
        }
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
      const reconciledTaskIds = getOrCreateRepoTaskSet(reconciledTasksByRepo, repoPath);
      const pendingTasks = tasks.filter((task) => !reconciledTaskIds.has(task.id));
      if (pendingTasks.length === 0) {
        return;
      }

      for (const task of pendingTasks) {
        reconciledTaskIds.add(task.id);
      }

      try {
        const plan = await buildReconcilePreloadPlan({
          repoPath,
          tasks: pendingTasks,
          isCancelled,
        });
        if (isCancelled() || !isCurrentRepo(repoPath)) {
          return;
        }

        liveAgentSessionStore.replaceRepoSnapshots(repoPath, plan.preloadedLiveAgentSessionsByKey);

        if (plan.taskIdsToReconcile.size === 0) {
          for (const { taskId } of plan.persistedByTask) {
            if (plan.skippedTaskErrors.has(taskId)) {
              reconciledTaskIds.delete(taskId);
              clearRetry("reconcile", repoPath, taskId);
              continue;
            }
            clearRetry("reconcile", repoPath, taskId);
          }
          return;
        }

        const reconcileTaskIds = Array.from(plan.taskIdsToReconcile);
        const results = await Promise.allSettled(
          reconcileTaskIds.map(async (taskId) => {
            const records =
              plan.persistedByTask.find((entry) => entry.taskId === taskId)?.records ?? [];
            await sessionHydration.reconcileLiveTaskSessions({
              taskId,
              persistedRecords: records,
              preloadedRuntimeLists: plan.preloadedRuntimeLists,
              preloadedRuntimeConnectionsByKey: plan.preloadedRuntimeConnectionsByKey,
              preloadedLiveAgentSessionsByKey: plan.preloadedLiveAgentSessionsByKey,
              allowRuntimeEnsure: false,
            });
            return taskId;
          }),
        );
        if (isCancelled()) {
          return;
        }

        const failedTaskErrors = new Map<string, unknown>();
        for (const [index, result] of results.entries()) {
          if (result.status === "fulfilled") {
            continue;
          }
          const taskId = reconcileTaskIds[index];
          if (taskId) {
            failedTaskErrors.set(taskId, result.reason);
          }
        }

        for (const { taskId } of plan.persistedByTask) {
          if (plan.skippedTaskErrors.has(taskId)) {
            reconciledTaskIds.delete(taskId);
            clearRetry("reconcile", repoPath, taskId);
            continue;
          }
          if (failedTaskErrors.has(taskId)) {
            continue;
          }
          clearRetry("reconcile", repoPath, taskId);
        }

        for (const [taskId, error] of failedTaskErrors) {
          reconciledTasksByRepo[repoPath]?.delete(taskId);
          scheduleRetry("reconcile", repoPath, taskId, error);
        }
      } catch (error) {
        if (isCancelled() || !isCurrentRepo(repoPath)) {
          return;
        }
        for (const task of pendingTasks) {
          reconciledTasksByRepo[repoPath]?.delete(task.id);
          scheduleRetry("reconcile", repoPath, task.id, error);
        }
      }
    },
  };
};
