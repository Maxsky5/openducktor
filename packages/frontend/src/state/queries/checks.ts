import type { RuntimeCheck, TaskStoreCheck } from "@openducktor/contracts";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
import { scheduleTask, type ScheduleTask } from "@/lib/scheduling";
import type { DiagnosticsFailureKind } from "@/types/diagnostics";
import { host } from "../operations/host";

export type ChecksQueryDependencies = {
  runtimeCheck: (force?: boolean) => Promise<RuntimeCheck>;
  taskStoreCheck: (repoPath: string) => Promise<TaskStoreCheck>;
};

const RUNTIME_CHECK_STALE_TIME_MS = 5 * 60_000;
const TASK_STORE_CHECK_STALE_TIME_MS = 60_000;
const DIAGNOSTICS_QUERY_TIMEOUT_MS = 15_000;
// A forced runtime check resolves the user PATH again. That probe alone can take 15 seconds.
const RUNTIME_CHECK_TIMEOUT_MS = 30_000;

const DEFAULT_CHECKS_QUERY_DEPENDENCIES: ChecksQueryDependencies = {
  runtimeCheck: (force = false) => host.runtimeCheck(force),
  taskStoreCheck: (repoPath) => host.taskStoreCheck(repoPath),
};

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
  failureKind: Exclude<DiagnosticsFailureKind, null>;
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

export const withDiagnosticsQueryTimeout = async <T>(
  promise: Promise<T>,
  scheduler: ScheduleTask,
  timeoutMs = DIAGNOSTICS_QUERY_TIMEOUT_MS,
): Promise<T> => {
  const { promise: timeoutPromise, reject: rejectTimeout } = Promise.withResolvers<never>();
  const cancelTimeout = scheduler(() => {
    rejectTimeout(new DiagnosticsQueryTimeoutError(timeoutMs));
  }, timeoutMs);

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
};

export const runtimeCheckQueryOptions = (
  force = false,
  runtimeCheck: ChecksQueryDependencies["runtimeCheck"] = DEFAULT_CHECKS_QUERY_DEPENDENCIES.runtimeCheck,
  scheduler: ScheduleTask = scheduleTask,
) =>
  queryOptions({
    queryKey: checksQueryKeys.runtime(),
    queryFn: (): Promise<RuntimeCheck> =>
      withDiagnosticsQueryTimeout(runtimeCheck(force), scheduler, RUNTIME_CHECK_TIMEOUT_MS),
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
