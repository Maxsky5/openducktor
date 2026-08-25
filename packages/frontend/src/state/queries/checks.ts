import type {
  RuntimeCheck,
  RuntimeDescriptor,
  RuntimeKind,
  TaskStoreCheck,
} from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
import { isRepoRuntimeHealthPendingReadiness } from "@/lib/repo-runtime-health";
import { scheduleTask, type ScheduleTask } from "@/lib/scheduling";
import type {
  RepoRuntimeFailureKind,
  RepoRuntimeHealthCheck,
  RepoRuntimeHealthMap,
} from "@/types/diagnostics";
import { host } from "../operations/host";

export type ChecksQueryDependencies = {
  runtimeCheck: (force?: boolean) => Promise<RuntimeCheck>;
  taskStoreCheck: (repoPath: string) => Promise<TaskStoreCheck>;
};

const RUNTIME_CHECK_STALE_TIME_MS = 5 * 60_000;
const TASK_STORE_CHECK_STALE_TIME_MS = 60_000;
const READY_REPO_RUNTIME_HEALTH_STALE_TIME_MS = 60_000;
export const PENDING_REPO_RUNTIME_HEALTH_REFETCH_INTERVAL_MS = 2_000;
const DIAGNOSTICS_QUERY_TIMEOUT_MS = 15_000;

const DEFAULT_CHECKS_QUERY_DEPENDENCIES: ChecksQueryDependencies = {
  runtimeCheck: (force = false) => host.runtimeCheck(force),
  taskStoreCheck: (repoPath) => host.taskStoreCheck(repoPath),
};

const sortRuntimeKindsForQueryKey = (runtimeKinds: RuntimeKind[]): RuntimeKind[] =>
  runtimeKinds.toSorted();

export class DiagnosticsQueryTimeoutError extends Error {
  readonly failureKind = "timeout" as const;
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms`);
    this.name = "DiagnosticsQueryTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

type ClassifiedDiagnosticsQueryError = {
  message: string;
  failureKind: Exclude<RepoRuntimeFailureKind, null>;
};

export const classifyDiagnosticsQueryError = (cause: unknown): ClassifiedDiagnosticsQueryError => {
  if (cause instanceof DiagnosticsQueryTimeoutError) {
    return {
      message: cause.message,
      failureKind: cause.failureKind,
    };
  }

  return {
    message: errorMessage(cause),
    failureKind: "error",
  };
};

const withDiagnosticsQueryTimeout = async <T>(
  promise: Promise<T>,
  scheduler: ScheduleTask,
): Promise<T> => {
  const { promise: timeoutPromise, reject: rejectTimeout } = Promise.withResolvers<never>();
  const cancelTimeout = scheduler(() => {
    rejectTimeout(new DiagnosticsQueryTimeoutError(DIAGNOSTICS_QUERY_TIMEOUT_MS));
  }, DIAGNOSTICS_QUERY_TIMEOUT_MS);

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    cancelTimeout();
  }
};

export const checksQueryKeys = {
  all: ["checks"] as const,
  runtime: () => [...checksQueryKeys.all, "runtime"] as const,
  taskStore: (repoPath: string) => [...checksQueryKeys.all, "task-store", repoPath] as const,
  runtimeHealth: (repoPath: string, runtimeKinds: RuntimeKind[]) =>
    [
      ...checksQueryKeys.all,
      "runtime-health",
      repoPath,
      ...sortRuntimeKindsForQueryKey(runtimeKinds),
    ] as const,
};

export const repoRuntimeHealthStaleTime = (
  runtimeHealthByRuntime: RepoRuntimeHealthMap | undefined,
): number => {
  const runtimeHealthEntries = Object.values(runtimeHealthByRuntime ?? {});
  if (runtimeHealthEntries.length === 0) {
    return 0;
  }

  return runtimeHealthEntries.every((runtimeHealth) => runtimeHealth?.status === "ready")
    ? READY_REPO_RUNTIME_HEALTH_STALE_TIME_MS
    : 0;
};

export const repoRuntimeHealthRefetchInterval = (
  runtimeHealthByRuntime: RepoRuntimeHealthMap | undefined,
): number | false => {
  const runtimeHealthEntries = Object.values(runtimeHealthByRuntime ?? {});
  const hasPendingRuntimeHealth = runtimeHealthEntries.some((runtimeHealth) =>
    isRepoRuntimeHealthPendingReadiness(runtimeHealth),
  );
  return hasPendingRuntimeHealth ? PENDING_REPO_RUNTIME_HEALTH_REFETCH_INTERVAL_MS : false;
};

export const runtimeCheckQueryOptions = (
  force = false,
  runtimeCheck: ChecksQueryDependencies["runtimeCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.runtimeCheck,
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions({
    queryKey: checksQueryKeys.runtime(),
    queryFn: (): Promise<RuntimeCheck> =>
      withDiagnosticsQueryTimeout(runtimeCheck(force), scheduler),
    staleTime: RUNTIME_CHECK_STALE_TIME_MS,
  });

export const taskStoreCheckQueryOptions = (
  repoPath: string,
  taskStoreCheck: ChecksQueryDependencies["taskStoreCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.taskStoreCheck,
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions({
    queryKey: checksQueryKeys.taskStore(repoPath),
    queryFn: (): Promise<TaskStoreCheck> =>
      withDiagnosticsQueryTimeout(taskStoreCheck(repoPath), scheduler),
    staleTime: TASK_STORE_CHECK_STALE_TIME_MS,
  });

export const repoRuntimeHealthQueryOptions = (
  repoPath: string,
  runtimeDefinitions: RuntimeDescriptor[],
  checkRepoRuntimeHealth: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<RepoRuntimeHealthCheck>,
) =>
  queryOptions({
    queryKey: checksQueryKeys.runtimeHealth(
      repoPath,
      runtimeDefinitions.map((definition) => definition.kind),
    ),
    queryFn: async (): Promise<RepoRuntimeHealthMap> => {
      const checks = await Promise.all(
        runtimeDefinitions.map(
          async (definition) =>
            [definition.kind, await checkRepoRuntimeHealth(repoPath, definition.kind)] as const,
        ),
      );

      const healthByRuntime: RepoRuntimeHealthMap = {};
      for (const [runtimeKind, health] of checks) {
        healthByRuntime[runtimeKind] = health;
      }
      return healthByRuntime;
    },
    staleTime: (query) => repoRuntimeHealthStaleTime(query.state.data),
    refetchInterval: (query) => repoRuntimeHealthRefetchInterval(query.state.data),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

export const loadRuntimeCheckFromQuery = (
  queryClient: QueryClient,
  runtimeCheck: ChecksQueryDependencies["runtimeCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.runtimeCheck,
  scheduler: ScheduleTask = scheduleTask,
): Promise<RuntimeCheck> =>
  queryClient.fetchQuery(runtimeCheckQueryOptions(false, runtimeCheck, scheduler));

export const loadTaskStoreCheckFromQuery = (
  queryClient: QueryClient,
  repoPath: string,
  taskStoreCheck: ChecksQueryDependencies["taskStoreCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.taskStoreCheck,
  scheduler: ScheduleTask = scheduleTask,
): Promise<TaskStoreCheck> =>
  queryClient.fetchQuery(taskStoreCheckQueryOptions(repoPath, taskStoreCheck, scheduler));
