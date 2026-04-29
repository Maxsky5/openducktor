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
import type { QueryClient } from "@tanstack/react-query";
import { appQueryClient } from "@/lib/query-client";
import { loadRuntimeListFromQuery, runtimeQueryKeys } from "@/state/queries/runtime";
import { host } from "../../shared/host";
import { ensureRuntimeAndInvalidateReadinessQueries } from "../../shared/runtime-readiness-publication";
import { resolveRuntimeRouteConnection } from "../runtime/runtime";
import { normalizeWorkingDirectory } from "../support/core";
import { requiresLiveWorktreeRuntime } from "../support/session-runtime-attachment";
import {
  isSessionRuntimeMetadataError,
  readPersistedRuntimeKind,
} from "../support/session-runtime-metadata";
import { canUseWorkspaceRuntimeForHydration } from "./hydration-runtime-policy";
import {
  getLiveAgentSessionCacheKey,
  LiveAgentSessionCache,
  liveAgentSessionLookupKey,
  RuntimeConnectionPreloadIndex,
} from "./live-agent-session-cache";
import type { LiveAgentSessionStore } from "./live-agent-session-store";
import {
  canUseRuntimeForRouteOnlyHydration,
  createRouteOnlyHydrationLookupKey,
  createRouteOnlyHydrationRuntimeConnection,
  hasExactNonRepoRootRuntime,
  isRepoRootWorkspaceRuntime,
  recordRouteOnlyHydrationPreload,
} from "./route-only-hydration";
import type { SessionHydrationOperations } from "./session-hydration-operations";

type HydrationScope = "bootstrap" | "reconcile";

type RuntimeConnectionScan = {
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
  directories: Set<string>;
  routeOnlyHydrationDirectories: Set<string>;
  runtimeConnectionsByDirectory: Map<string, AgentRuntimeConnection>;
};

type ReconcileTarget = {
  taskId: string;
  records: AgentSessionRecord[];
};

type ReconcilePreloadPlan = {
  persistedByTask: Array<{ taskId: string; records: AgentSessionRecord[] }>;
  reconcileTargets: ReconcileTarget[];
  retryableUnmatchedTaskIds: Set<string>;
  routeOnlyHydrationRecordKeys: Set<string>;
  preloadedRuntimeLists: Map<RuntimeKind, RuntimeInstanceSummary[]>;
  preloadedRuntimeConnections: RuntimeConnectionPreloadIndex;
  preloadedLiveAgentSessionsByKey: Map<string, LiveAgentSessionSnapshot[]>;
  skippedTaskErrors: Map<string, unknown>;
};

type ReconcilePreloadMetadata = {
  persistedByTask: Array<{ taskId: string; records: AgentSessionRecord[] }>;
  persistedLiveSessionKeys: Set<string>;
  runtimeKinds: Set<RuntimeKind>;
  desiredDirectoriesByRuntimeKind: Map<RuntimeKind, Set<string>>;
  runtimeKindsAllowedToEnsureRepoRoot: Set<RuntimeKind>;
  skippedTaskErrors: Map<string, unknown>;
};

const nextSessionRetryDelayMs = (attempt: number): number => Math.min(5_000, 500 * 2 ** attempt);

const invalidateRuntimeList = async (
  queryClient: QueryClient,
  runtimeKind: RuntimeKind,
  repoPath: string,
): Promise<void> => {
  await queryClient.invalidateQueries({
    queryKey: runtimeQueryKeys.list(runtimeKind, repoPath),
    exact: true,
    refetchType: "none",
  });
};

const getOrCreateRepoStringSet = (
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

const tupleKey = (parts: string[]): string => JSON.stringify(parts);

const persistedSessionRecordKey = (taskId: string, record: AgentSessionRecord): string =>
  tupleKey([
    taskId,
    readPersistedRuntimeKind(record),
    record.sessionId,
    record.externalSessionId ?? record.sessionId,
    normalizeWorkingDirectory(record.workingDirectory),
  ]);

const createRetryableUnmatchedReconcileError = (taskId: string, repoPath: string): Error =>
  new Error(
    `No matching live agent session was found for task '${taskId}' in repo '${repoPath}' after scanning a compatible runtime.`,
  );

const toTaskWithUnreconciledRecords = (
  task: TaskCard,
  reconciledRecordKeys: Set<string>,
): TaskCard | null => {
  const unreconciledRecords = (task.agentSessions ?? []).filter((record) => {
    try {
      return !reconciledRecordKeys.has(persistedSessionRecordKey(task.id, record));
    } catch (error) {
      if (isSessionRuntimeMetadataError(error)) {
        return true;
      }
      throw error;
    }
  });

  return unreconciledRecords.length > 0 ? { ...task, agentSessions: unreconciledRecords } : null;
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

const liveAgentSessionMatchKey = (
  runtimeKind: RuntimeKind,
  runtimeConnection: AgentRuntimeConnection,
  workingDirectory: string,
  externalSessionId: string,
): string =>
  `${liveAgentSessionLookupKey(runtimeKind, runtimeConnection, workingDirectory)}::${externalSessionId}`;

const createCancelledReconcilePreloadPlan = ({
  persistedByTask,
  preloadedRuntimeLists,
  preloadedRuntimeConnections,
  preloadedLiveAgentSessionsByKey = new Map<string, LiveAgentSessionSnapshot[]>(),
  routeOnlyHydrationRecordKeys = new Set<string>(),
  skippedTaskErrors,
}: {
  persistedByTask: ReconcilePreloadPlan["persistedByTask"];
  preloadedRuntimeLists: Map<RuntimeKind, RuntimeInstanceSummary[]>;
  preloadedRuntimeConnections: RuntimeConnectionPreloadIndex;
  preloadedLiveAgentSessionsByKey?: Map<string, LiveAgentSessionSnapshot[]>;
  routeOnlyHydrationRecordKeys?: Set<string>;
  skippedTaskErrors: Map<string, unknown>;
}): ReconcilePreloadPlan => ({
  persistedByTask,
  reconcileTargets: [],
  retryableUnmatchedTaskIds: new Set<string>(),
  routeOnlyHydrationRecordKeys,
  preloadedRuntimeLists,
  preloadedRuntimeConnections,
  preloadedLiveAgentSessionsByKey,
  skippedTaskErrors,
});

const hasMatchingPreloadedLiveSession = ({
  record,
  runtimeKind,
  runtimeConnections,
  preloadedLiveSessionKeys,
}: {
  record: AgentSessionRecord;
  runtimeKind: RuntimeKind;
  runtimeConnections: RuntimeConnectionPreloadIndex;
  preloadedLiveSessionKeys: Set<string>;
}): boolean => {
  const externalSessionId = record.externalSessionId ?? record.sessionId;
  if (!externalSessionId) {
    return false;
  }

  const candidateRuntimeConnections = runtimeConnections.findCandidates(
    runtimeKind,
    record.workingDirectory,
  );
  return candidateRuntimeConnections.some((runtimeConnection) =>
    preloadedLiveSessionKeys.has(
      liveAgentSessionMatchKey(
        runtimeKind,
        runtimeConnection,
        record.workingDirectory,
        externalSessionId,
      ),
    ),
  );
};

const buildReconcileTargets = ({
  persistedByTask,
  skippedTaskErrors,
  repoPath,
  routeProbedHydrationRuntimeConnections,
  preloadedRuntimeConnections,
  scannedRuntimeConnections,
  preloadedLiveSessionKeys,
}: {
  persistedByTask: ReconcilePreloadPlan["persistedByTask"];
  skippedTaskErrors: Map<string, unknown>;
  repoPath: string;
  routeProbedHydrationRuntimeConnections: RuntimeConnectionPreloadIndex;
  preloadedRuntimeConnections: RuntimeConnectionPreloadIndex;
  scannedRuntimeConnections: RuntimeConnectionPreloadIndex;
  preloadedLiveSessionKeys: Set<string>;
}): {
  reconcileTargets: ReconcileTarget[];
  retryableUnmatchedTaskIds: Set<string>;
  routeOnlyHydrationRecordKeys: Set<string>;
} => {
  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);
  const retryableUnmatchedTaskIds = new Set<string>();
  const routeOnlyHydrationRecordKeys = new Set<string>();

  const reconcileTargets = persistedByTask.flatMap<ReconcileTarget>(({ taskId, records }) => {
    if (skippedTaskErrors.has(taskId)) {
      return [];
    }

    const recordsToReconcile = records.filter((record) => {
      const externalSessionId = record.externalSessionId ?? record.sessionId;
      if (!externalSessionId) {
        return false;
      }
      if (
        !canUseWorkspaceRuntimeForHydration(record, repoPath) &&
        normalizeWorkingDirectory(record.workingDirectory) === normalizedRepoPath
      ) {
        return false;
      }

      const runtimeKind = readPersistedRuntimeKind(record);
      const hasMatchingLiveSession = hasMatchingPreloadedLiveSession({
        record,
        runtimeKind,
        runtimeConnections: preloadedRuntimeConnections,
        preloadedLiveSessionKeys,
      });
      const canHydrateThroughResolvableConnection = preloadedRuntimeConnections.hasAny(
        runtimeKind,
        record.workingDirectory,
      );
      const canHydrateThroughRouteOnlyConnection = routeProbedHydrationRuntimeConnections.hasAny(
        runtimeKind,
        record.workingDirectory,
      );
      const canReconcile = hasMatchingLiveSession || canHydrateThroughResolvableConnection;
      if (canReconcile) {
        if (!hasMatchingLiveSession && canHydrateThroughRouteOnlyConnection) {
          routeOnlyHydrationRecordKeys.add(persistedSessionRecordKey(taskId, record));
        }
        return true;
      }

      if (scannedRuntimeConnections.hasAny(runtimeKind, record.workingDirectory)) {
        retryableUnmatchedTaskIds.add(taskId);
      }
      return false;
    });

    return recordsToReconcile.length > 0 ? [{ taskId, records: recordsToReconcile }] : [];
  });

  return { reconcileTargets, retryableUnmatchedTaskIds, routeOnlyHydrationRecordKeys };
};

const collectRepoRootWorktreeScanDirectories = ({
  records,
  runtimeKind,
  runtimeEntries,
  repoPathKey,
}: {
  records: AgentSessionRecord[];
  runtimeKind: RuntimeKind;
  runtimeEntries: RuntimeInstanceSummary[];
  repoPathKey: string;
}): string[] => {
  const directories = new Set<string>();

  for (const record of records) {
    const externalSessionId = record.externalSessionId ?? record.sessionId;
    const workingDirectory = normalizeWorkingDirectory(record.workingDirectory);
    if (
      !externalSessionId ||
      !requiresLiveWorktreeRuntime(record) ||
      workingDirectory === repoPathKey ||
      readPersistedRuntimeKind(record) !== runtimeKind ||
      hasExactNonRepoRootRuntime({
        runtimes: runtimeEntries,
        workingDirectory,
        repoPath: repoPathKey,
      })
    ) {
      continue;
    }

    directories.add(workingDirectory);
  }

  return Array.from(directories);
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

  const persistedLiveSessionKeys = new Set<string>();
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
        taskLiveSessionKeys.add(tupleKey([runtimeKind, externalSessionId]));
        getOrCreateMapSet(taskDesiredDirectoriesByRuntimeKind, runtimeKind).add(
          normalizeWorkingDirectory(record.workingDirectory),
        );
        if (canUseWorkspaceRuntimeForHydration(record, repoPath)) {
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
      persistedLiveSessionKeys.add(liveSessionKey);
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
    persistedLiveSessionKeys,
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
  queryClient = appQueryClient,
  runtimeEnsure = (nextRepoPath, nextRuntimeKind) =>
    host.runtimeEnsure(nextRepoPath, nextRuntimeKind),
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
  ) => Promise<RuntimeInstanceSummary>;
}) => {
  const bootstrappedTasksByRepo: Record<string, Set<string>> = {};
  const reconciledRecordKeysByRepo: Record<string, Set<string>> = {};
  const inFlightReconcileTasksByRepo: Record<string, Set<string>> = {};
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
      persistedLiveSessionKeys,
      runtimeKinds,
      desiredDirectoriesByRuntimeKind,
      runtimeKindsAllowedToEnsureRepoRoot,
      skippedTaskErrors,
    } = collectReconcilePreloadMetadata({ tasks, repoPath });

    const runtimeConnections = new Map<string, RuntimeConnectionScan>();
    const scannedRuntimeConnections = new RuntimeConnectionPreloadIndex();
    const addRuntimeConnectionScan = (
      runtimeKind: RuntimeKind,
      runtimeConnection: AgentRuntimeConnection,
      workingDirectory: string,
      allowRouteOnlyHydration = false,
    ): void => {
      const scanKey = getLiveAgentSessionCacheKey(runtimeKind, runtimeConnection);
      const scan = runtimeConnections.get(scanKey) ?? {
        runtimeKind,
        runtimeConnection,
        directories: new Set<string>(),
        routeOnlyHydrationDirectories: new Set<string>(),
        runtimeConnectionsByDirectory: new Map<string, AgentRuntimeConnection>(),
      };
      const normalizedWorkingDirectory = normalizeWorkingDirectory(workingDirectory);
      scan.directories.add(normalizedWorkingDirectory);
      if (allowRouteOnlyHydration) {
        scan.routeOnlyHydrationDirectories.add(normalizedWorkingDirectory);
      }
      scan.runtimeConnectionsByDirectory.set(normalizedWorkingDirectory, runtimeConnection);
      runtimeConnections.set(scanKey, scan);
      scannedRuntimeConnections.add(runtimeKind, runtimeConnection);
    };
    const preloadedRuntimeLists = new Map<RuntimeKind, RuntimeInstanceSummary[]>();
    const preloadedRuntimeConnections = new RuntimeConnectionPreloadIndex();
    const routeProbedHydrationRuntimeConnections = new RuntimeConnectionPreloadIndex();
    for (const runtimeKind of runtimeKinds) {
      const runtimes = await loadRuntimeListFromQuery(queryClient, runtimeKind, repoPath);
      if (isCancelled()) {
        return createCancelledReconcilePreloadPlan({
          persistedByTask,
          preloadedRuntimeLists,
          preloadedRuntimeConnections,
          skippedTaskErrors,
        });
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
          ensureRuntime: runtimeEnsure,
        });
        await invalidateRuntimeList(queryClient, runtimeKind, repoPath);
        if (isCancelled()) {
          return createCancelledReconcilePreloadPlan({
            persistedByTask,
            preloadedRuntimeLists,
            preloadedRuntimeConnections,
            skippedTaskErrors,
          });
        }
        runtimeEntries.push(ensuredRuntime);
      }

      preloadedRuntimeLists.set(runtimeKind, runtimeEntries);

      const canScanRepoRootWorkspaceRuntime = (runtime: RuntimeInstanceSummary): boolean => {
        const normalizedRuntimeDirectory = normalizeWorkingDirectory(runtime.workingDirectory);
        if (runtime.role !== "workspace" || normalizedRuntimeDirectory !== repoPathKey) {
          return true;
        }

        return persistedByTask.some(({ records }) =>
          records.some((record) => {
            try {
              return (
                readPersistedRuntimeKind(record) === runtimeKind &&
                normalizeWorkingDirectory(record.workingDirectory) === normalizedRuntimeDirectory &&
                canUseWorkspaceRuntimeForHydration(record, repoPath)
              );
            } catch (error) {
              if (isSessionRuntimeMetadataError(error)) {
                return false;
              }
              throw error;
            }
          }),
        );
      };

      const repoRootWorktreeScanDirectories = collectRepoRootWorktreeScanDirectories({
        records: persistedByTask.flatMap(({ taskId, records }) =>
          skippedTaskErrors.has(taskId) ? [] : records,
        ),
        runtimeKind,
        runtimeEntries,
        repoPathKey,
      });

      for (const runtime of runtimeEntries) {
        const isRepoRootWorkspaceRuntimeForRepo = isRepoRootWorkspaceRuntime(runtime, repoPathKey);
        const canScanRepoRootRuntime = canScanRepoRootWorkspaceRuntime(runtime);
        if (
          isRepoRootWorkspaceRuntimeForRepo &&
          !canScanRepoRootRuntime &&
          repoRootWorktreeScanDirectories.length === 0
        ) {
          continue;
        }

        const { runtimeConnection } = resolveRuntimeRouteConnection(
          runtime.runtimeRoute,
          runtime.workingDirectory,
        );
        if (!isRepoRootWorkspaceRuntimeForRepo) {
          if (desiredDirectories.has(normalizeWorkingDirectory(runtime.workingDirectory))) {
            preloadedRuntimeConnections.add(runtimeKind, runtimeConnection);
            addRuntimeConnectionScan(runtimeKind, runtimeConnection, runtime.workingDirectory);
          }
          continue;
        }

        if (desiredDirectories.has(repoPathKey) && canScanRepoRootRuntime) {
          addRuntimeConnectionScan(runtimeKind, runtimeConnection, runtime.workingDirectory);
          preloadedRuntimeConnections.add(runtimeKind, runtimeConnection);
        }
        if (canUseRuntimeForRouteOnlyHydration(runtime, repoPathKey)) {
          for (const workingDirectory of repoRootWorktreeScanDirectories) {
            const worktreeRuntimeConnection = createRouteOnlyHydrationRuntimeConnection(
              runtime,
              workingDirectory,
            );
            addRuntimeConnectionScan(
              runtimeKind,
              worktreeRuntimeConnection,
              workingDirectory,
              true,
            );
          }
        }
      }
    }

    const preloadedLiveAgentSessionsByKey = new Map<string, LiveAgentSessionSnapshot[]>();
    const preloadedLiveSessionKeys = new Set<string>();
    const runtimeSessionScanCache = new LiveAgentSessionCache(agentEngine);

    for (const input of runtimeConnections.values()) {
      const runtimeSessions = await runtimeSessionScanCache.load({
        runtimeKind: input.runtimeKind,
        runtimeConnection: input.runtimeConnection,
        directories: Array.from(input.directories),
      });
      if (isCancelled()) {
        return createCancelledReconcilePreloadPlan({
          persistedByTask,
          preloadedRuntimeLists,
          preloadedRuntimeConnections,
          preloadedLiveAgentSessionsByKey,
          skippedTaskErrors,
        });
      }

      const sessionsByWorkingDirectory = new Map<string, LiveAgentSessionSnapshot[]>();
      for (const runtimeSession of runtimeSessions) {
        const workingDirectoryKey = normalizeWorkingDirectory(runtimeSession.workingDirectory);
        const sessionsForDirectory = sessionsByWorkingDirectory.get(workingDirectoryKey) ?? [];
        sessionsForDirectory.push(runtimeSession);
        sessionsByWorkingDirectory.set(workingDirectoryKey, sessionsForDirectory);
      }

      for (const [workingDirectory, sessionsForDirectory] of sessionsByWorkingDirectory) {
        const runtimeConnectionForDirectory =
          input.runtimeConnectionsByDirectory.get(workingDirectory) ?? input.runtimeConnection;
        preloadedRuntimeConnections.add(input.runtimeKind, runtimeConnectionForDirectory);
        preloadedLiveAgentSessionsByKey.set(
          liveAgentSessionLookupKey(
            input.runtimeKind,
            runtimeConnectionForDirectory,
            workingDirectory,
          ),
          sessionsForDirectory,
        );
      }

      for (const workingDirectory of input.routeOnlyHydrationDirectories) {
        const runtimeConnectionForDirectory =
          input.runtimeConnectionsByDirectory.get(workingDirectory) ?? input.runtimeConnection;
        const lookupKey = createRouteOnlyHydrationLookupKey({
          runtimeKind: input.runtimeKind,
          runtimeConnection: runtimeConnectionForDirectory,
          workingDirectory,
        });
        const liveSessionsForRouteOnlyDirectory =
          preloadedLiveAgentSessionsByKey.get(lookupKey) ?? [];
        // A successful directory-scoped scan through a repo-root HTTP runtime proves that
        // this transport can address the worktree directory. Preserve the worktree
        // directory in the request-scoped connection; do not substitute or persist the
        // repo-root runtime as the session's durable runtime.
        recordRouteOnlyHydrationPreload({
          runtimeKind: input.runtimeKind,
          runtimeConnection: runtimeConnectionForDirectory,
          workingDirectory,
          preloadedRuntimeConnections,
          routeProbedHydrationRuntimeConnections,
          preloadedLiveAgentSessionsByKey,
          liveSessionsForDirectory: liveSessionsForRouteOnlyDirectory,
        });
      }

      for (const runtimeSession of runtimeSessions) {
        const workingDirectory = normalizeWorkingDirectory(runtimeSession.workingDirectory);
        const runtimeConnectionForDirectory =
          input.runtimeConnectionsByDirectory.get(workingDirectory) ?? input.runtimeConnection;
        const liveSessionKey = liveAgentSessionMatchKey(
          input.runtimeKind,
          runtimeConnectionForDirectory,
          workingDirectory,
          runtimeSession.externalSessionId,
        );
        if (
          persistedLiveSessionKeys.has(
            tupleKey([input.runtimeKind, runtimeSession.externalSessionId]),
          )
        ) {
          preloadedLiveSessionKeys.add(liveSessionKey);
        }
      }
    }

    const { reconcileTargets, retryableUnmatchedTaskIds, routeOnlyHydrationRecordKeys } =
      buildReconcileTargets({
        persistedByTask,
        skippedTaskErrors,
        repoPath,
        routeProbedHydrationRuntimeConnections,
        preloadedRuntimeConnections,
        scannedRuntimeConnections,
        preloadedLiveSessionKeys,
      });

    return {
      persistedByTask,
      reconcileTargets,
      retryableUnmatchedTaskIds,
      routeOnlyHydrationRecordKeys,
      preloadedRuntimeLists,
      preloadedRuntimeConnections,
      preloadedLiveAgentSessionsByKey,
      skippedTaskErrors,
    };
  };

  return {
    resetRepo(repoPath: string): void {
      liveAgentSessionStore.clearRepo(repoPath);
      getOrCreateRepoStringSet(bootstrappedTasksByRepo, repoPath);
      getOrCreateRepoStringSet(reconciledRecordKeysByRepo, repoPath).clear();
      getOrCreateRepoStringSet(inFlightReconcileTasksByRepo, repoPath).clear();
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
      const bootstrappedTasks = getOrCreateRepoStringSet(bootstrappedTasksByRepo, repoPath);
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
      const reconciledRecordKeys = getOrCreateRepoStringSet(reconciledRecordKeysByRepo, repoPath);
      const inFlightReconcileTasks = getOrCreateRepoStringSet(
        inFlightReconcileTasksByRepo,
        repoPath,
      );
      const pendingTasks = tasks.flatMap((task) => {
        if (inFlightReconcileTasks.has(task.id)) {
          return [];
        }

        const taskWithUnreconciledRecords = toTaskWithUnreconciledRecords(
          task,
          reconciledRecordKeys,
        );
        return taskWithUnreconciledRecords ? [taskWithUnreconciledRecords] : [];
      });
      if (pendingTasks.length === 0) {
        return;
      }

      for (const task of pendingTasks) {
        inFlightReconcileTasks.add(task.id);
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

        if (plan.reconcileTargets.length === 0) {
          for (const { taskId } of plan.persistedByTask) {
            if (plan.skippedTaskErrors.has(taskId)) {
              clearRetry("reconcile", repoPath, taskId);
              continue;
            }
            if (plan.retryableUnmatchedTaskIds.has(taskId)) {
              scheduleRetry(
                "reconcile",
                repoPath,
                taskId,
                createRetryableUnmatchedReconcileError(taskId, repoPath),
              );
              continue;
            }
            clearRetry("reconcile", repoPath, taskId);
          }
          return;
        }

        const results = await Promise.allSettled(
          plan.reconcileTargets.map(async ({ taskId, records }) => {
            await sessionHydration.reconcileLiveTaskSessions({
              taskId,
              persistedRecords: records,
              preloadedRuntimeLists: plan.preloadedRuntimeLists,
              preloadedRuntimeConnections: plan.preloadedRuntimeConnections,
              preloadedLiveAgentSessionsByKey: plan.preloadedLiveAgentSessionsByKey,
              allowRuntimeEnsure: false,
            });
            return { taskId, records };
          }),
        );
        if (isCancelled()) {
          return;
        }

        const failedTaskErrors = new Map<string, unknown>();
        for (const [index, result] of results.entries()) {
          if (result.status === "fulfilled") {
            for (const record of result.value.records) {
              const recordKey = persistedSessionRecordKey(result.value.taskId, record);
              if (!plan.routeOnlyHydrationRecordKeys.has(recordKey)) {
                reconciledRecordKeys.add(recordKey);
              }
            }
            continue;
          }
          const taskId = plan.reconcileTargets[index]?.taskId;
          if (taskId) {
            failedTaskErrors.set(taskId, result.reason);
          }
        }

        for (const { taskId } of plan.persistedByTask) {
          if (plan.skippedTaskErrors.has(taskId)) {
            clearRetry("reconcile", repoPath, taskId);
            continue;
          }
          if (failedTaskErrors.has(taskId)) {
            continue;
          }
          if (plan.retryableUnmatchedTaskIds.has(taskId)) {
            scheduleRetry(
              "reconcile",
              repoPath,
              taskId,
              createRetryableUnmatchedReconcileError(taskId, repoPath),
            );
            continue;
          }
          clearRetry("reconcile", repoPath, taskId);
        }

        for (const [taskId, error] of failedTaskErrors) {
          scheduleRetry("reconcile", repoPath, taskId, error);
        }
      } catch (error) {
        if (isCancelled() || !isCurrentRepo(repoPath)) {
          return;
        }
        for (const task of pendingTasks) {
          scheduleRetry("reconcile", repoPath, task.id, error);
        }
      } finally {
        for (const task of pendingTasks) {
          inFlightReconcileTasks.delete(task.id);
        }
      }
    },
  };
};
